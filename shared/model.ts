import { z } from 'zod'

export const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/)
export const frame = z.number().int().min(0).max(2_160_000)
export const color = z.string().regex(/^#[a-fA-F0-9]{6}$/)
export const property = z.enum(['x', 'y', 'scale', 'rotation', 'opacity'])
export const easing = z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold'])
const values = {
  x: z.number().finite().min(-8192).max(8192),
  y: z.number().finite().min(-8192).max(8192),
  scale: z.number().finite().min(0).max(20),
  rotation: z.number().finite().min(-360_000).max(360_000),
  opacity: z.number().finite().min(0).max(1),
}
export const transform = z.object(values)
const key = z.object({ frame, value: z.number().finite(), ease: easing })
const keys = z.record(property, z.array(key).max(2000))
const props = z.record(z.string().regex(/^[a-zA-Z_]\w{0,63}$/), z.union([z.string().max(4000), z.number().finite(), z.boolean()]))
export const style = z.object({
  text: z.string().max(4000),
  fill: color,
  fontSize: z.number().int().min(8).max(768),
  fontFamily: z.enum(['Arial', 'Georgia', 'Consolas']),
  bold: z.boolean(),
  width: z.number().int().min(1).max(3840),
  height: z.number().int().min(1).max(3840),
  radius: z.number().int().min(0).max(1920),
  fit: z.enum(['contain', 'cover']),
  volume: z.number().finite().min(0).max(2),
  muted: z.boolean(),
  fadeIn: frame,
  fadeOut: frame,
})

export const clip = z.object({
  id,
  name: z.string().trim().min(1).max(160),
  kind: z.enum(['video', 'audio', 'image', 'text', 'shape', 'react']),
  start: frame,
  duration: frame.min(1),
  offset: frame,
  assetId: id.optional(),
  codeId: id.optional(),
  props,
  transform,
  keys,
  style,
})
export const track = z.object({
  id,
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['visual', 'audio']),
  hidden: z.boolean(),
  muted: z.boolean(),
  locked: z.boolean(),
  clips: z.array(clip).max(2000),
})
export const asset = z.object({
  id,
  name: z.string().min(1).max(260),
  kind: z.enum(['video', 'audio', 'image']),
  duration: frame,
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  hasAudio: z.boolean(),
  extension: z.string().regex(/^\.[a-z0-9]+$/),
  peaks: z.array(z.number().min(0).max(1)).max(96),
})
export const code = z.object({
  id,
  path: z.string().max(180).regex(/^(?:[\w-]+\/)*[\w-]+\.(?:ts|tsx)$/),
  kind: z.enum(['script', 'react', 'module']),
  source: z.string().max(100_000),
})
export const settings = z.object({
  name: z.string().trim().min(1).max(100),
  width: z.number().int().min(320).max(3840).multipleOf(2),
  height: z.number().int().min(320).max(3840).multipleOf(2),
  fps: z.union([z.literal(24), z.literal(30), z.literal(60)]),
  background: color,
})
export const project = z.object({
  schemaVersion: z.literal(1),
  ...settings.shape,
  tracks: z.array(track).max(100),
  assets: z.array(asset).max(1500),
  code: z.array(code).max(100),
})
export const clipChanges = clip.omit({ id: true, kind: true, assetId: true, codeId: true }).partial()
export const trackChanges = track.omit({ id: true, kind: true, clips: true }).partial()
export const edit = z.discriminatedUnion('type', [
  z.object({ type: z.literal('addTrack'), track, before: id.optional() }),
  z.object({ type: z.literal('updateTrack'), id, changes: trackChanges }),
  z.object({ type: z.literal('moveTrack'), id, before: id.optional() }),
  z.object({ type: z.literal('addClip'), trackId: id, clip }),
  z.object({ type: z.literal('changeClip'), id, changes: clipChanges }),
  z.object({ type: z.literal('moveClip'), id, trackId: id, start: frame }),
  z.object({ type: z.literal('splitClip'), id, rightId: id, at: frame }),
  z.object({ type: z.literal('deleteClip'), id }),
  z.object({ type: z.literal('setKey'), id, property, key }),
  z.object({ type: z.literal('deleteKey'), id, property, frame }),
  z.object({ type: z.literal('addAsset'), asset }),
  z.object({ type: z.literal('saveCode'), file: code }),
  z.object({ type: z.literal('deleteCode'), id }),
  z.object({ type: z.literal('settings'), changes: settings.omit({ fps: true }).partial() }),
])
export const edits = z.array(edit).min(1).max(200)
export const label = z.string().trim().min(1).max(120)
export const revision = z.number().int().nonnegative()
export const batch = z.object({ revision, label, edits, requestId: id.optional() })

export type Clip = z.infer<typeof clip>
export type Track = z.infer<typeof track>
export type Asset = z.infer<typeof asset>
export type CodeFile = z.infer<typeof code>
export type Project = z.infer<typeof project>
export type Settings = z.infer<typeof settings>
export type Edit = z.infer<typeof edit>
export type Property = z.infer<typeof property>
export type Easing = z.infer<typeof easing>
export type Revision = { id: string; revision: number; project: Project; canUndo: boolean; canRedo: boolean; lastEdit: string }
export type ProjectSummary = { id: string; name: string; updated: string }
export type ExportJob = {
  id: string; projectId: string; revision: number; status: 'queued' | 'rendering' | 'complete' | 'error' | 'cancelled';
  done: number; total: number; name: string; error?: string;
}

export function newTrack(name: string, kind: Track['kind'] = 'visual'): Track {
  return { id: crypto.randomUUID(), name, kind, hidden: false, muted: false, locked: false, clips: [] }
}

export function newClip(kind: Clip['kind'], name: string, start: number, duration: number): Clip {
  return {
    id: crypto.randomUUID(), kind, name, start, duration, offset: 0, props: {},
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    keys: {},
    style: {
      text: 'Title', fill: '#ffffff', fontSize: 96, fontFamily: 'Arial', bold: true, width: 640, height: 360,
      radius: 24, fit: 'contain', volume: 1, muted: false, fadeIn: 0, fadeOut: 0,
    },
  }
}

export function newProject(input: Partial<Settings> = {}): Project {
  return {
    schemaVersion: 1, name: 'Untitled project', width: 1920, height: 1080, fps: 30, background: '#121218',
    ...input, tracks: [newTrack('Video 1'), newTrack('Audio 1', 'audio')], assets: [], code: [],
  }
}

export function getClip(project: Project, id: string) {
  for (const track of project.tracks) {
    const clip = track.clips.find(clip => clip.id === id)
    if (clip) return { track, clip }
  }
}

export function durationOf(project: Project) {
  return project.tracks.reduce((end, track) => track.clips.reduce((last, clip) => Math.max(last, clip.start + clip.duration), end), 0)
}

export function isActive(clip: Clip, frame: number) {
  return clip.start <= frame && frame < clip.start + clip.duration
}

function ease(progress: number, curve: Easing) {
  switch (curve) {
    case 'hold': return 0
    case 'ease-in': return progress * progress
    case 'ease-out': return 1 - (1 - progress) ** 2
    case 'ease-in-out': return progress * progress * (3 - 2 * progress)
    default: return progress
  }
}

export function animated(clip: Clip, property: Property, localFrame: number) {
  const keys = clip.keys[property]
  if (!keys?.length) return clip.transform[property]
  const next = keys.findIndex(key => key.frame > localFrame)
  if (next === -1) return keys[keys.length - 1].value
  if (next === 0) return keys[0].value
  const left = keys[next - 1]
  const right = keys[next]
  const progress = ease((localFrame - left.frame) / (right.frame - left.frame), left.ease)
  return left.value + (right.value - left.value) * progress
}

export function timecode(frame: number, fps: number) {
  const segments = [Math.floor(frame / fps / 3600), Math.floor(frame / fps / 60) % 60, Math.floor(frame / fps) % 60, frame % fps]
  return segments.map(value => String(value).padStart(2, '0')).join(':')
}

export function validateProject(value: Project) {
  const usedIds = new Set<string>()
  const useId = (id: string) => {
    if (usedIds.has(id)) throw new Error(`Duplicate project ID: ${id}`)
    usedIds.add(id)
  }
  const codePaths = new Set<string>()
  const assets = new Map(value.assets.map(asset => [asset.id, asset]))
  const files = new Map(value.code.map(file => [file.id, file]))
  for (const asset of value.assets) useId(asset.id)
  for (const file of value.code) {
    useId(file.id)
    if (codePaths.has(file.path.toLowerCase())) throw new Error(`Duplicate code path: ${file.path}`)
    codePaths.add(file.path.toLowerCase())
    if (file.kind === 'react' && !file.path.endsWith('.tsx')) throw new Error('React clips need a .tsx file.')
  }
  for (const track of value.tracks) {
    useId(track.id)
    let end = 0
    track.clips.sort((left, right) => left.start - right.start)
    for (const clip of track.clips) {
      useId(clip.id)
      if ((clip.kind === 'audio') !== (track.kind === 'audio')) throw new Error(`“${clip.name}” needs a compatible track.`)
      if (clip.start < end) throw new Error(`“${clip.name}” overlaps another clip on ${track.name}.`)
      end = clip.start + clip.duration
      if (end > 2_160_000 || clip.offset + clip.duration > 2_160_000) throw new Error('Clip exceeds the timeline limit.')
      if (clip.kind === 'video' || clip.kind === 'audio' || clip.kind === 'image') {
        const asset = clip.assetId && assets.get(clip.assetId)
        if (!asset || asset.kind !== clip.kind) throw new Error(`Media is missing or incompatible for “${clip.name}”.`)
        if (clip.kind !== 'image' && clip.offset + clip.duration > asset.duration) throw new Error(`“${clip.name}” exceeds its source duration.`)
      }
      if (clip.kind === 'react' && (!clip.codeId || files.get(clip.codeId)?.kind !== 'react')) {
        throw new Error(`“${clip.name}” needs a React source file.`)
      }
      for (const name of property.options) {
        const keys = clip.keys[name]
        if (!keys) continue
        keys.sort((left, right) => left.frame - right.frame)
        let previous = -1
        for (const key of keys) {
          if (previous === key.frame) throw new Error('A property can have one keyframe per frame.')
          values[name].parse(key.value)
          previous = key.frame
        }
      }
    }
  }
  return value
}

export function applyEdits(current: Project, edits: Edit[]) {
  const next = structuredClone(current)
  const findTrack = (id: string) => {
    const track = next.tracks.find(track => track.id === id)
    if (!track) throw new Error('Track no longer exists.')
    return track
  }
  const editableTrack = (id: string) => {
    const track = findTrack(id)
    if (track.locked) throw new Error(`Unlock ${track.name} to edit it.`)
    return track
  }
  const editableClip = (id: string) => {
    const result = getClip(next, id)
    if (!result) throw new Error('Clip no longer exists.')
    editableTrack(result.track.id)
    return result
  }
  const insertTrack = (track: Track, before?: string) => {
    if (!before) next.tracks.push(track)
    else next.tracks.splice(next.tracks.indexOf(findTrack(before)), 0, track)
  }
  for (const edit of edits) {
    switch (edit.type) {
      case 'addTrack': insertTrack(edit.track, edit.before); break
      case 'updateTrack': Object.assign(findTrack(edit.id), edit.changes); break
      case 'moveTrack': {
        if (edit.before === edit.id) break
        const track = editableTrack(edit.id)
        next.tracks.splice(next.tracks.indexOf(track), 1)
        insertTrack(track, edit.before)
        break
      }
      case 'addClip': editableTrack(edit.trackId).clips.push(edit.clip); break
      case 'changeClip': Object.assign(editableClip(edit.id).clip, edit.changes); break
      case 'moveClip': {
        const { track, clip } = editableClip(edit.id)
        const destination = editableTrack(edit.trackId)
        track.clips.splice(track.clips.indexOf(clip), 1)
        clip.start = edit.start
        destination.clips.push(clip)
        break
      }
      case 'splitClip': {
        const { track, clip } = editableClip(edit.id)
        const leftDuration = edit.at - clip.start
        if (leftDuration <= 0 || leftDuration >= clip.duration) throw new Error('Place the playhead inside the clip to split it.')
        const originalDuration = clip.duration
        const originalStyle = { ...clip.style }
        const right = {
          ...structuredClone(clip), id: edit.rightId, start: edit.at, duration: originalDuration - leftDuration,
          offset: clip.offset + leftDuration,
          style: { ...originalStyle, fadeIn: 0 },
        }
        clip.duration = leftDuration
        clip.style.fadeOut = 0
        track.clips.push(right)
        break
      }
      case 'deleteClip': {
        const { track, clip } = editableClip(edit.id)
        track.clips.splice(track.clips.indexOf(clip), 1)
        break
      }
      case 'setKey': {
        const { clip } = editableClip(edit.id)
        const keys = clip.keys[edit.property] || []
        clip.keys[edit.property] = [...keys.filter(key => key.frame !== edit.key.frame), edit.key]
        break
      }
      case 'deleteKey': {
        const { clip } = editableClip(edit.id)
        clip.keys[edit.property] = clip.keys[edit.property]?.filter(key => key.frame !== edit.frame) || []
        break
      }
      case 'addAsset': next.assets.push(edit.asset); break
      case 'saveCode': {
        const index = next.code.findIndex(file => file.id === edit.file.id)
        if (index === -1) next.code.push(edit.file)
        else next.code[index] = edit.file
        break
      }
      case 'deleteCode': next.code = next.code.filter(file => file.id !== edit.id); break
      case 'settings': Object.assign(next, edit.changes); break
    }
  }
  return validateProject(project.parse(next))
}

export function fitOnTrack(track: Track, start: number, duration: number, except?: string) {
  return !track.locked && start >= 0 && track.clips.every(clip => clip.id === except || start + duration <= clip.start || start >= clip.start + clip.duration)
}

export function placeClip(project: Project, clip: Clip, preferred?: string): Edit[] {
  const kind = clip.kind === 'audio' ? 'audio' : 'visual'
  const candidate = project.tracks.find(track => track.id === preferred && track.kind === kind && fitOnTrack(track, clip.start, clip.duration))
    || project.tracks.find(track => track.kind === kind && fitOnTrack(track, clip.start, clip.duration))
  if (candidate) return [{ type: 'addClip', trackId: candidate.id, clip }]
  const track = newTrack(clip.name.slice(0, 100), kind)
  track.clips.push(clip)
  return [{ type: 'addTrack', track, before: kind === 'visual' ? project.tracks[0]?.id : undefined }]
}
