import { spawn } from 'node:child_process'
import { copyFile, mkdir, rm, rmdir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { mediaDir } from './config.mjs'
import { HttpError } from './store.mjs'

const extensions = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi', '.mp3', '.m4a', '.wav', '.flac', '.ogg', '.opus', '.aac', '.png', '.jpg', '.jpeg', '.webp'])
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const formats = 'mov,matroska,webm,avi,mp3,wav,flac,ogg,aac,png_pipe,jpeg_pipe,webp_pipe,image2'
export const uploadLimit = 8 * 1024 ** 3
export const ffmpeg = process.env.FRAMEWELL_FFMPEG || 'ffmpeg'
const ffprobe = process.env.FRAMEWELL_FFPROBE || 'ffprobe'

export function runProcess(command, args, { signal, input = false } = {}) {
  signal?.throwIfAborted()
  const child = spawn(command, args, { windowsHide: true, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] })
  let diagnostics = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', value => { diagnostics = (diagnostics + value).slice(-6000) })
  const stop = () => child.kill()
  signal?.addEventListener('abort', stop, { once: true })
  const done = new Promise((resolve, reject) => {
    child.once('error', error => reject(error.code === 'ENOENT' ? new Error(`Could not find ${command}. See the setup instructions.`) : error))
    child.once('close', code => {
      signal?.removeEventListener('abort', stop)
      if (signal?.aborted) reject(signal.reason)
      else if (code === 0) resolve()
      else reject(new Error(diagnostics.trim() || `${command} exited with status ${code}.`))
    })
  })
  done.catch(() => {})
  return { child, done }
}

async function collect(command, args, options, maxBytes = 4 * 1024 * 1024) {
  const { child, done } = runProcess(command, args, options)
  const chunks = []
  let size = 0
  try {
    for await (const chunk of child.stdout) {
      size += chunk.length
      if (size > maxBytes) throw new Error('Media metadata exceeded its size limit.')
      chunks.push(chunk)
    }
    await done
    return Buffer.concat(chunks)
  } finally {
    if (child.exitCode === null && !child.killed) child.kill()
  }
}

export function inputArgs(path) {
  return ['-protocol_whitelist', 'file,pipe', '-format_whitelist', formats, '-i', path]
}

const ffmpegFlags = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y']
export const frameFilter = fps => `fps=fps=${fps}:start_time=0`
function sizeFilter(width, height) {
  return `scale=w='min(${width},iw)':h='min(${height},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`
}

export function assetPaths(projectId, asset) {
  const root = join(mediaDir, projectId, asset.id)
  return {
    root, original: join(root, 'source' + asset.extension),
    preview: join(root, asset.kind === 'image' ? 'preview.png' : 'preview.webm'),
    thumb: join(root, 'thumbnail.jpg'),
  }
}

export function previewMime(asset) {
  if (asset.kind === 'image') return 'image/png'
  return asset.kind === 'audio' ? 'audio/webm' : 'video/webm'
}

async function readPeaks(path, duration, options) {
  const { child, done } = runProcess(ffmpeg, [...ffmpegFlags, ...inputArgs(path), '-map', '0:a:0',
    '-ac', '1', '-ar', '2000', '-f', 's16le', 'pipe:1'], options)
  const peaks = Array.from({ length: 72 }, () => 0)
  const interval = Math.max(1, Math.ceil(duration * 2000 / peaks.length))
  let index = 0
  let tail
  try {
    for await (const incoming of child.stdout) {
      const chunk = tail ? Buffer.concat([tail, incoming]) : incoming
      const length = chunk.length - chunk.length % 2
      tail = length !== chunk.length ? chunk.subarray(length) : undefined
      for (let offset = 0; offset < length; offset += 2) {
        const bucket = Math.min(peaks.length - 1, Math.floor(index++ / interval))
        peaks[bucket] = Math.max(peaks[bucket], Math.abs(chunk.readInt16LE(offset)) / 32768)
      }
    }
    await done
    return peaks.map(value => Math.round(value * 1000) / 1000)
  } finally {
    if (child.exitCode === null && !child.killed) child.kill()
  }
}

export async function ingestMedia(projectId, sourcePath, originalName, fps, signal) {
  const extension = extname(originalName).toLowerCase()
  if (!extensions.has(extension)) throw new HttpError(415, 'Choose a supported video, audio, or image file.')
  const source = await stat(sourcePath)
  if (!source.isFile() || source.size < 1 || source.size > uploadLimit) throw new HttpError(413, 'The media file must be between 1 byte and 8 GB.')
  const probeData = await collect(ffprobe, ['-v', 'error', ...inputArgs(sourcePath), '-show_format', '-show_streams', '-of', 'json'], { signal })
  const metadata = JSON.parse(probeData.toString())
  const video = metadata.streams?.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic)
  const audio = metadata.streams?.find(stream => stream.codec_type === 'audio')
  const isImage = imageExtensions.has(extension) && video
  if (!video && !audio) throw new Error('The file contains no usable video, image, or audio stream.')
  if (imageExtensions.has(extension) && !isImage) throw new Error('The image could not be decoded.')
  const kind = isImage ? 'image' : video ? 'video' : 'audio'
  const seconds = [video?.duration, audio?.duration, metadata.format?.duration].map(Number).find(value => Number.isFinite(value) && value > 0)
  const duration = isImage ? 0 : Math.floor(seconds * fps)
  if (!video && (!Number.isFinite(duration) || duration < 1 || duration > 2_160_000)) {
    throw new Error('The media duration is unavailable or exceeds the frame limit.')
  }
  if (!isImage && duration > 2_160_000) throw new Error('The media duration exceeds the frame limit.')
  if (video && (video.width > 8192 || video.height > 8192)) throw new Error('Media dimensions must be at most 8192 pixels.')
  const rotated = video?.side_data_list?.some(data => Math.abs(data.rotation || 0) % 180 === 90)
  const asset = {
    id: crypto.randomUUID(), name: basename(originalName).slice(0, 260), kind, duration, extension,
    width: rotated ? video.height : video?.width || 0,
    height: rotated ? video.width : video?.height || 0, hasAudio: !isImage && Boolean(audio), peaks: [],
  }
  const paths = assetPaths(projectId, asset)
  await mkdir(paths.root, { recursive: true })
  try {
    await copyFile(sourcePath, paths.original)
    const args = [...ffmpegFlags, ...inputArgs(paths.original)]
    if (kind === 'image') {
      await collect(ffmpeg, [...args, '-map', `0:${video.index}`, '-frames:v', '1', '-vf', sizeFilter(3840, 3840), '-update', '1', paths.preview], { signal })
    } else {
      if (video) {
        args.push('-map', `0:${video.index}`, '-vf', `${frameFilter(fps)},${sizeFilter(1280, 1280)}`,
          '-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0', '-deadline', 'good', '-cpu-used', '4', '-g', String(fps), '-pix_fmt', 'yuv420p')
      }
      if (audio) args.push('-map', `0:${audio.index}`, '-af', 'aresample=48000:async=1:first_pts=0', '-c:a', 'libopus', '-b:a', '160k', '-ac', '2')
      const progress = await collect(ffmpeg, [...args, '-sn', '-dn', '-map_metadata', '-1', '-stats_period', '3600',
        '-progress', 'pipe:1', '-nostats', paths.preview], { signal })
      if (video) {
        const decoded = Number([...progress.toString().matchAll(/^frame=\s*(\d+)\s*$/gm)].at(-1)?.[1])
        if (!Number.isInteger(decoded) || decoded < 1 || decoded > 2_160_000) {
          throw new Error('Video could not be decoded within the timeline frame limit.')
        }
        asset.duration = decoded
      }
    }
    if (video) {
      await collect(ffmpeg, [...ffmpegFlags, '-i', paths.preview, '-map', '0:v:0', '-frames:v', '1', '-vf', sizeFilter(360, 220),
        '-q:v', '3', '-update', '1', paths.thumb], { signal })
    }
    if (asset.hasAudio) asset.peaks = await readPeaks(paths.preview, asset.duration / fps, { signal })
    return asset
  } catch (error) {
    await discardMedia(projectId, asset)
    throw error
  }
}

export async function discardMedia(projectId, asset) {
  const { root, original, preview, thumb } = assetPaths(projectId, asset)
  await Promise.all([original, preview, thumb].map(path => rm(path, { force: true })))
  await rmdir(root).catch(error => { if (error.code !== 'ENOENT') throw error })
}

export async function* videoFrames(path, { offset, duration, fps, width, height, signal }) {
  const filters = [frameFilter(fps), `trim=start_frame=${offset}:end_frame=${offset + duration}`, sizeFilter(width, height)]
  const args = [...ffmpegFlags, ...inputArgs(path), '-map', '0:V:0', '-vf', filters.join(','),
    '-an', '-sn', '-fps_mode', 'passthrough', '-threads', '2', '-c:v', 'png', '-f', 'image2pipe', 'pipe:1']
  const { child, done } = runProcess(ffmpeg, args, { signal })
  // FFmpeg emits a PNG byte stream. A chunk's length and IEND mark frame boundaries.
  let bytes = Buffer.alloc(0)
  let cursor = 8
  try {
    for await (const chunk of child.stdout) {
      bytes = Buffer.concat([bytes, chunk])
      while (cursor + 12 <= bytes.length) {
        const length = bytes.readUInt32BE(cursor)
        if (length > 96 * 1024 * 1024) throw new Error('A decoded video frame exceeded its size limit.')
        const end = cursor + length + 12
        if (end > bytes.length) break
        if (bytes.toString('ascii', cursor + 4, cursor + 8) === 'IEND') {
          yield bytes.subarray(0, end)
          bytes = bytes.subarray(end)
          cursor = 8
        } else {
          cursor = end
        }
      }
    }
    await done
    if (bytes.length) throw new Error('FFmpeg returned an incomplete video frame.')
  } finally {
    if (child.exitCode === null && !child.killed) child.kill()
  }
}
