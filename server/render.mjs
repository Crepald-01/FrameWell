import { chromium } from 'playwright'
import { basename, join } from 'node:path'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { newClip, newTrack, clip, durationOf, isActive } from '../shared/model.ts'
import { editorOrigin, sandboxOrigin, outputDir } from './config.mjs'
import { assetPaths, ffmpeg, inputArgs, runProcess, videoFrames } from './media.mjs'
import { compileCode } from './code.mjs'
import { HttpError, getExport, interruptExports, saveExport } from './store.mjs'

let browser
let launch
async function getBrowser() {
  if (browser?.isConnected()) return browser
  launch ||= chromium.launch({ headless: true }).then(instance => {
    browser = instance
    return instance
  }).finally(() => { launch = undefined })
  return launch
}

export async function closeRenderer() {
  await browser?.close()
}

async function inRenderer(project, token, action, signal) {
  signal?.throwIfAborted()
  const browser = await getBrowser()
  signal?.throwIfAborted()
  const context = await browser.newContext({ viewport: { width: project.width, height: project.height }, deviceScaleFactor: 1 })
  const cancel = () => { context.close().catch(() => {}) }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    signal?.throwIfAborted()
    await context.route('**/*', route => {
      const url = new URL(route.request().url())
      return url.origin === editorOrigin || url.origin === sandboxOrigin || url.protocol === 'data:' ? route.continue() : route.abort()
    })
    const page = await context.newPage()
    await page.goto(`${editorOrigin}/render.html`, { waitUntil: 'domcontentloaded', timeout: 30_000, referer: editorOrigin })
    await page.waitForFunction(() => Boolean(window.framewell), { timeout: 20_000 })
    return await action(page, token)
  } finally {
    signal?.removeEventListener('abort', cancel)
    await context.close().catch(() => {})
  }
}

async function initializeScene(page, snapshot, token) {
  const fileIds = new Set(snapshot.project.tracks.filter(track => !track.hidden).flatMap(track =>
    track.clips.filter(clip => clip.kind === 'react').map(clip => clip.codeId)))
  const bundles = Object.fromEntries(await Promise.all([...fileIds].map(async id => [id, await compileCode(snapshot.project, id)])))
  const media = {}
  for (const asset of snapshot.project.assets) {
    if (asset.kind === 'image') media[asset.id] = `/api/render-media/${snapshot.id}/${asset.id}?access=${token}`
  }
  return page.evaluate(input => window.framewell.prepare(input), { project: snapshot.project, bundles, media })
}

function activeVideos(project, frame) {
  return project.tracks.filter(track => !track.hidden).flatMap(track =>
    track.clips.filter(clip => clip.kind === 'video' && isActive(clip, frame)))
}

async function decodeExact(snapshot, frame) {
  const images = {}
  await Promise.all(activeVideos(snapshot.project, frame).map(async clip => {
    const asset = snapshot.project.assets.find(asset => asset.id === clip.assetId)
    const frames = videoFrames(assetPaths(snapshot.id, asset).original, {
      offset: clip.offset + frame - clip.start, duration: 1, fps: snapshot.project.fps,
      width: snapshot.project.width, height: snapshot.project.height,
    })
    try {
      const next = await frames.next()
      if (next.done) throw new Error(`No decoded media frame for “${clip.name}”.`)
      images[clip.id] = 'data:image/png;base64,' + next.value.toString('base64')
    } finally {
      await frames.return()
    }
  }))
  return images
}

export function getFrame(snapshot, token, frame) {
  if (frame >= durationOf(snapshot.project)) throw new HttpError(400, 'Frame is outside the composition.')
  return inRenderer(snapshot.project, token, async page => {
    await initializeScene(page, snapshot, token)
    const videos = await decodeExact(snapshot, frame)
    await page.evaluate(input => window.framewell.draw(input.frame, input.videos), { frame, videos })
    const image = await page.screenshot({ type: 'jpeg', quality: 85, timeout: 20_000 })
    return image.toString('base64')
  })
}

const scriptedClip = clip.omit({ id: true, transform: true, style: true }).partial({
  offset: true, props: true, keys: true,
}).extend({ transform: clip.shape.transform.partial().optional(), style: clip.shape.style.partial().optional() })
const layerOutput = z.array(z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['visual', 'audio']).default('visual'),
  clips: z.array(scriptedClip).min(1).max(200),
})).min(1).max(30)

export async function runScript(snapshot, token, fileId, at) {
  const compiled = await compileCode(snapshot.project, fileId)
  if (compiled.kind !== 'script') throw new HttpError(400, 'Choose a TypeScript layer script.')
  const { width, height, fps, assets } = snapshot.project
  const output = await inRenderer(snapshot.project, token, page =>
    page.evaluate(({ compiled, context }) => window.framewell.build(compiled, context), {
      compiled, context: { width, height, fps, playhead: at, assets },
    }))
  const layers = layerOutput.parse(output)
  if (layers.reduce((sum, layer) => sum + layer.clips.length, 0) > 500) throw new Error('A single script can create up to 500 clips.')
  return layers.map(layer => {
    const track = newTrack(layer.name, layer.kind)
    track.clips = layer.clips.map(input => {
      const defaults = newClip(input.kind, input.name, input.start + at, input.duration)
      return {
        ...defaults, ...input, start: defaults.start,
        transform: { ...defaults.transform, ...input.transform },
        style: { ...defaults.style, ...input.style },
      }
    })
    return { type: 'addTrack', track, before: layer.kind === 'visual' ? snapshot.project.tracks[0]?.id : undefined }
  })
}

const queue = []
let current
let stopping = false
export const exportPath = job => join(outputDir, job.name)
const partialPath = job => join(outputDir, `.${job.id}.part.mp4`)
const filterPath = job => join(outputDir, `.${job.id}.audio.ffgraph`)

export async function recoverExports() {
  await mkdir(outputDir, { recursive: true })
  for (const job of interruptExports()) {
    await Promise.all([partialPath(job), filterPath(job)].map(path => rm(path, { force: true })))
  }
}

export function startExport(snapshot, token) {
  if (stopping) throw new HttpError(503, 'The editor is shutting down.')
  const total = durationOf(snapshot.project)
  if (!total) throw new HttpError(400, 'Add a clip before exporting.')
  if (queue.length >= 20) throw new HttpError(429, 'The export queue is full.')
  const id = crypto.randomUUID()
  const slug = snapshot.project.name.replace(/[^a-zA-Z0-9 _-]+/g, '').trim().slice(0, 70) || 'Framewell'
  const job = { id, projectId: snapshot.id, revision: snapshot.revision, status: 'queued', done: 0, total, name: `${slug}-${id.slice(0, 8)}.mp4` }
  saveExport(job)
  queue.push({ snapshot, token, job, controller: new AbortController() })
  queueMicrotask(workQueue)
  return { ...job }
}

export function cancelExport(projectId, id) {
  if (current?.job.projectId === projectId && current?.job.id === id) {
    if (!current.finalizing) current.controller.abort(new Error('Export cancelled.'))
    return getExport(projectId, id)
  }
  const index = queue.findIndex(entry => entry.job.id === id && entry.job.projectId === projectId)
  if (index !== -1) {
    const [{ job }] = queue.splice(index, 1)
    saveExport({ ...job, status: 'cancelled' })
  }
  return getExport(projectId, id)
}

export async function stopExports() {
  stopping = true
  for (const { job } of queue.splice(0)) {
    saveExport({ ...job, status: 'error', error: 'The editor stopped before this export could start.' })
  }
  if (current && !current.finalizing) current.controller.abort(new Error('The editor stopped during export.'))
  await current?.task
}

function workQueue() {
  if (stopping || current || !queue.length) return
  current = queue.shift()
  const entry = current
  entry.task = executeExport(entry).finally(() => {
    current = undefined
    queueMicrotask(workQueue)
  })
  entry.task.catch(error => console.error(error.message))
}

function audioArguments(snapshot) {
  const { fps, tracks, assets } = snapshot.project
  const inputs = []
  const filters = []
  const outputs = []
  const groups = new Map()
  const media = new Map(assets.map(asset => [asset.id, asset]))
  for (const track of tracks) {
    if (track.muted) continue
    for (const clip of track.clips) {
      if (!clip.assetId || clip.style.muted || !clip.style.volume) continue
      const asset = media.get(clip.assetId)
      if (!asset?.hasAudio) continue
      const clips = groups.get(asset.id) || []
      clips.push(clip)
      groups.set(asset.id, clips)
    }
  }
  for (const [assetId, clips] of groups) {
    const index = inputs.length + 1
    inputs.push(inputArgs(assetPaths(snapshot.id, media.get(assetId)).original))
    const branches = clips.map((_, clipIndex) => `[source${index}_${clipIndex}]`)
    const format = 'aresample=48000:async=1:first_pts=0,aformat=sample_fmts=fltp:channel_layouts=stereo'
    const split = branches.length > 1 ? `,asplit=${branches.length}` : ''
    filters.push(`[${index}:a:0]${format}${split}${branches.join('')}`)
    clips.forEach((clip, clipIndex) => {
      const seconds = clip.duration / fps
      const fadeIn = Math.min(clip.style.fadeIn, clip.duration) / fps
      const fadeOut = Math.min(clip.style.fadeOut, clip.duration) / fps
      const delaySamples = Math.round(clip.start * 48_000 / fps)
      const chain = [
        `atrim=start=${clip.offset / fps}:duration=${seconds}`, 'asetpts=PTS-STARTPTS', `volume=${clip.style.volume}`,
      ]
      if (fadeIn) chain.push(`afade=t=in:st=0:d=${fadeIn}`)
      if (fadeOut) chain.push(`afade=t=out:st=${seconds - fadeOut}:d=${fadeOut}`)
      chain.push(`adelay=${delaySamples}S:all=1`)
      const output = `[mix${outputs.length}]`
      outputs.push(output)
      filters.push(`${branches[clipIndex]}${chain.join(',')}${output}`)
    })
  }
  if (outputs.length) {
    const mix = outputs.length > 1 ? `amix=inputs=${outputs.length}:normalize=0,` : ''
    filters.push(`${outputs.join('')}${mix}apad,atrim=duration=${durationOf(snapshot.project) / fps}[mix]`)
  }
  return { inputs: inputs.flat(), graph: filters.join(';') }
}

function waitForDrain(stream, signal) {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const drain = () => finish()
    const closed = () => finish(new Error('The video encoder closed its input.'))
    const aborted = () => finish(signal.reason)
    function finish(error) {
      stream.removeListener('drain', drain)
      stream.removeListener('error', finish)
      stream.removeListener('close', closed)
      signal.removeEventListener('abort', aborted)
      if (error) reject(error)
      else resolve()
    }
    stream.once('drain', drain)
    stream.once('error', finish)
    stream.once('close', closed)
    signal.addEventListener('abort', aborted, { once: true })
  })
}

async function renderVideo(snapshot, token, job, signal) {
  const project = snapshot.project
  const audio = audioArguments(snapshot)
  const audioMap = audio.graph ? ['-map', '[mix]', '-c:a', 'aac', '-b:a', '256k'] : []
  const audioFilter = []
  if (audio.graph.length > 15_000) {
    await writeFile(filterPath(job), audio.graph)
    audioFilter.push('-/filter_complex', filterPath(job))
  } else if (audio.graph) audioFilter.push('-filter_complex', audio.graph)
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(project.fps),
    '-vcodec', 'png', '-i', 'pipe:0', ...audio.inputs, ...audioFilter, '-map', '0:v:0', ...audioMap,
    '-c:v', 'libx264', '-crf', '18', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', partialPath(job)]
  const { child, done } = runProcess(ffmpeg, args, { input: true, signal })
  child.stdout.resume()
  let pipeError
  child.stdin.on('error', error => { pipeError = error })
  const decoders = new Map()
  try {
    await inRenderer(project, token, async page => {
      await initializeScene(page, snapshot, token)
      for (let frame = 0; frame < job.total; frame++) {
        signal.throwIfAborted()
        if (pipeError) throw pipeError
        const active = activeVideos(project, frame)
        for (const [id, decoder] of decoders) {
          if (!active.some(clip => clip.id === id)) {
            await decoder.return()
            decoders.delete(id)
          }
        }
        const videos = Object.fromEntries(await Promise.all(active.map(async clip => {
          if (!decoders.has(clip.id)) {
            const asset = project.assets.find(asset => asset.id === clip.assetId)
            decoders.set(clip.id, videoFrames(assetPaths(snapshot.id, asset).original, {
              offset: clip.offset, duration: clip.duration, fps: project.fps,
              width: project.width, height: project.height, signal,
            }))
          }
          const next = await decoders.get(clip.id).next()
          if (next.done) throw new Error(`No decoded media frame for “${clip.name}” at frame ${frame}.`)
          return [clip.id, 'data:image/png;base64,' + next.value.toString('base64')]
        })))
        await page.evaluate(input => window.framewell.draw(input.frame, input.videos), { frame, videos })
        const image = await page.screenshot({ type: 'png', timeout: 20_000 })
        if (!child.stdin.write(image)) {
          if (pipeError) throw pipeError
          await waitForDrain(child.stdin, signal)
        }
        job.done = frame + 1
        if (job.done % 5 === 0 || job.done === job.total) saveExport(job)
      }
    }, signal)
    child.stdin.end()
    await done
  } catch (error) {
    if (child.exitCode === null && !child.killed) child.kill()
    if (pipeError && !signal.aborted) await done
    throw error
  } finally {
    await Promise.allSettled([...decoders.values()].map(decoder => decoder.return()))
    await done.catch(() => {})
  }
}

async function executeExport(entry) {
  const { snapshot, token, job, controller } = entry
  const { signal } = controller
  try {
    job.status = 'rendering'
    saveExport(job)
    await renderVideo(snapshot, token, job, signal)
    signal.throwIfAborted()
    entry.finalizing = true
    await rename(partialPath(job), exportPath(job))
    job.status = 'complete'
  } catch (error) {
    job.status = signal.aborted ? 'cancelled' : 'error'
    if (!signal.aborted) job.error = error.message
    await rm(partialPath(job), { force: true }).catch(() => {})
  } finally {
    await rm(filterPath(job), { force: true }).catch(() => {})
    saveExport(job)
  }
}
