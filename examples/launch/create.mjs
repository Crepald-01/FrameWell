import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { newClip } from '../../shared/model.ts'
import { dataDir, inboxDir, outputDir } from '../../server/config.mjs'

const title = 'Framewell Launch'
const story = [
  { name: '01 · Make it move', beat: 'opening', start: 0, duration: 66 },
  { name: '02 · Cut, layer, animate', beat: 'timeline', start: 66, duration: 90 },
  { name: '03 · AI in the edit', beat: 'mcp', start: 156, duration: 74 },
  { name: '04 · Framewell', beat: 'signature', start: 230, duration: 70 },
]
const stockName = 'Launch score'
const sourcePath = 'Launch.tsx'
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('../../server/mcp.mjs', import.meta.url))],
  env: { FRAMEWELL_DATA_DIR: dataDir },
  stderr: 'inherit',
})
const studio = new Client({ name: 'framewell-launch', version: '1.0.0' })

async function call(name, args = {}) {
  const result = await studio.callTool({ name, arguments: args }, undefined, { timeout: 300_000 })
  if (result.isError) throw new Error(result.content.map(item => item.text || '').join('\n'))
  return result.structuredContent || JSON.parse(result.content[0].text)
}

function score() {
  const rate = 48_000
  const sampleCount = rate * 10
  const data = Buffer.alloc(44 + sampleCount * 4)
  data.write('RIFF', 0)
  data.writeUInt32LE(data.length - 8, 4)
  data.write('WAVEfmt ', 8)
  data.writeUInt32LE(16, 16)
  data.writeUInt16LE(1, 20)
  data.writeUInt16LE(2, 22)
  data.writeUInt32LE(rate, 24)
  data.writeUInt32LE(rate * 4, 28)
  data.writeUInt16LE(4, 32)
  data.writeUInt16LE(16, 34)
  data.write('data', 36)
  data.writeUInt32LE(sampleCount * 4, 40)

  const tau = Math.PI * 2
  const notes = [146.83, 220, 261.63, 349.23, 440, 523.25, 440, 329.63]
  const hits = [0.016, 0.58, 1.14, 1.68, 2.20, 2.7, 3.2, 3.7, 4.2, 4.7, 5.20, 5.72, 6.24, 6.77, 7.67]
  const cuts = [2.20, 5.20, 230 / 30]
  let seed = 9382
  let smoothNoise = 0
  for (let sample = 0; sample < sampleCount; sample++) {
    const t = sample / rate
    const accent = t >= 7.67
    const groove = t * 4
    const pulse = groove - Math.floor(groove)
    const note = notes[Math.floor(groove) % notes.length]
    const pluck = Math.sin(tau * note * pulse / 4) * Math.min(1, pulse * 60) * Math.exp(-pulse * 4.3) * 0.034
    const drift = Math.sin(tau * 55 * t) * 0.052 + Math.sin(tau * 82.41 * t) * 0.022
    const pad = Math.sin(tau * 146.83 * t) * 0.014 + Math.sin(tau * 220.19 * t) * 0.011 + Math.sin(tau * 329.63 * t) * 0.009
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0
    const noise = seed / 2147483648
    smoothNoise = smoothNoise * 0.93 + noise * 0.07
    let kick = 0
    for (const hit of hits) {
      const since = t - hit
      if (since >= 0 && since < 0.28) {
        kick += (0.18 * Math.sin(tau * (54 * since + 1.6 * (1 - Math.exp(-40 * since)))) * Math.exp(-since * 17) +
          noise * 0.024 * Math.exp(-since * 78)) * Math.min(1, since * 650)
      }
    }
    let sweep = 0
    for (const cut of cuts) {
      const dt = t - cut
      if (dt >= -0.33 && dt <= 0.10) {
        const attack = Math.pow((dt + 0.33) / 0.43, 2) * Math.min(1, (0.10 - dt) / 0.10)
        sweep += attack * (smoothNoise * 0.18 + noise * 0.028)
      }
    }
    const logoT = t - 230 / 30
    const logo = logoT > 0 ? Math.exp(-logoT * 2.0) * Math.min(1, logoT * 38) * (
      0.10 * Math.sin(tau * 146.83 * logoT) + 0.08 * Math.sin(tau * 220 * logoT) +
      0.048 * Math.sin(tau * 293.66 * logoT) + 0.032 * Math.sin(tau * 440 * logoT)
    ) : 0
    const intro = Math.min(1, t / 0.10)
    const end = Math.min(1, (10 - t) / 0.45)
    const bed = (drift + pad) * (accent ? 0.32 : 0.56 + 0.44 * Math.sin(tau * 0.38 * t) ** 2)
    const sum = bed + kick + sweep + logo + (accent ? 0 : pluck)
    const side = 0.016 * Math.sin(tau * 329.92 * t) * Math.sin(tau * 0.54 * t) + sweep * 0.3
    const amp = intro * end * 2
    data.writeInt16LE(Math.round(Math.tanh((sum + side) * amp) * 32767), 44 + sample * 4)
    data.writeInt16LE(Math.round(Math.tanh((sum - side) * amp) * 32767), 46 + sample * 4)
  }
  return data
}

async function addScore(snapshot) {
  const existing = snapshot.project.assets.find(asset => asset.kind === 'audio' && asset.name.startsWith(stockName))
  if (existing) return { snapshot, asset: existing }
  await mkdir(inboxDir, { recursive: true })
  const name = `${stockName} ${crypto.randomUUID().slice(0, 8)}.wav`
  const path = join(inboxDir, name)
  await writeFile(path, score(), { flag: 'wx' })
  try {
    const imported = await call('import_media', { projectId: snapshot.id, revision: snapshot.revision, name })
    return { snapshot: imported, asset: imported.project.assets.find(asset => asset.name === name) }
  } finally {
    await rm(path, { force: true })
  }
}

async function buildProject() {
  const found = (await call('list_projects')).projects.find(item => item.name === title)
  const project = found
    ? await call('get_project', { projectId: found.id })
    : await call('create_project', { name: title, width: 1920, height: 1080, fps: 30, background: '#101017' })
  if (project.project.fps !== 30 || project.project.width !== 1920 || project.project.height !== 1080) {
    throw new Error('Framewell Launch requires a 1920 × 1080 project at 30 fps.')
  }
  const { snapshot, asset } = await addScore(project)
  const source = await readFile(new URL('./Launch.tsx', import.meta.url), 'utf8')
  const old = snapshot.project.code.find(file => file.path === sourcePath)
  const file = { id: old?.id || crypto.randomUUID(), path: sourcePath, kind: 'react', source }
  const clips = snapshot.project.tracks.flatMap(track => track.clips)
  const edits = []
  if (old?.source !== source) edits.push({ type: 'saveCode', file })
  if (!clips.some(clip => clip.codeId === file.id)) {
    const visual = snapshot.project.tracks.find(track => track.kind === 'visual' && !track.clips.length && !track.locked)
    const sound = snapshot.project.tracks.find(track => track.kind === 'audio' && !track.clips.length && !track.locked)
    if (!visual || !sound) throw new Error('The launch project needs an empty video track and audio track.')
    edits.push(
      { type: 'updateTrack', id: visual.id, changes: { name: 'Motion design' } },
      { type: 'updateTrack', id: sound.id, changes: { name: 'Original score' } },
      ...story.map(shot => ({
        type: 'addClip',
        trackId: visual.id,
        clip: {
          ...newClip('react', shot.name, shot.start, shot.duration),
          codeId: file.id,
          props: { beat: shot.beat, headline: '', accent: '#c7b4ff' },
        },
      })),
      { type: 'addClip', trackId: sound.id, clip: { ...newClip('audio', stockName, 0, 300), assetId: asset.id } },
    )
  }
  if (!edits.length) return snapshot
  return call('apply_edits', {
    projectId: snapshot.id, revision: snapshot.revision, label: 'Build Framewell launch film', requestId: crypto.randomUUID(), edits,
  })
}

try {
  await studio.connect(transport)
  const snapshot = await buildProject()
  console.log(`Saved editable Framewell project at revision ${snapshot.revision}.`)
  const frame = await studio.callTool({ name: 'inspect_frame', arguments: { projectId: snapshot.id, frame: 46 } })
  if (frame.isError) throw new Error(frame.content.map(item => item.text || '').join('\n'))
  if (!frame.content.some(item => item.type === 'image' && item.data.length > 500)) throw new Error('Framewell returned no picture for the launch project.')
  console.log('The MCP server rendered the opening composition.')

  const started = await call('start_export', { projectId: snapshot.id, revision: snapshot.revision })
  let lastReported = -1
  while (true) {
    const job = await call('get_export', { projectId: snapshot.id, jobId: started.id })
    if (job.status === 'complete') {
      const output = fileURLToPath(new URL('../../Framewell Launch.mp4', import.meta.url))
      await copyFile(join(outputDir, job.name), output)
      console.log(`Exported ${job.total} frames to ${output}`)
      break
    }
    if (job.status === 'error' || job.status === 'cancelled') throw new Error(job.error || `Export ${job.status}.`)
    const progress = Math.floor(job.done * 10 / job.total)
    if (progress !== lastReported) {
      lastReported = progress
      console.log(`Export ${job.status} · ${job.done}/${job.total} frames`)
    }
    await setTimeout(1100)
  }
} finally {
  await studio.close()
}
