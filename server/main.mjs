import express from 'express'
import multer from 'multer'
import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile, mkdir, rename, rm, writeFile, realpath, lstat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { batch, frame, id, label, revision, settings } from '../shared/model.ts'
import { editorOrigin, sandboxOrigin, dataDir, inboxDir, mediaDir, runtimeFile, stagingDir } from './config.mjs'
import { HttpError, getProject, listProjects, createProject, prepareEdit, commitEdit, travelHistory, getExport } from './store.mjs'
import { assetPaths, discardMedia, ingestMedia, previewMime, uploadLimit } from './media.mjs'
import { compileCode, validateCode } from './code.mjs'
import { cancelExport, closeRenderer, exportPath, getFrame, recoverExports, runScript, startExport, stopExports } from './render.mjs'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const token = randomBytes(32).toString('base64url')
const app = express()
const sandbox = express()
const listeners = new Map()
const editorCsp = [
  "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "font-src 'self'",
  "img-src 'self' blob: data:", "media-src 'self' blob:", "connect-src 'self'", "worker-src 'self' blob:",
  `frame-src ${sandboxOrigin}`, "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'",
].join('; ')
const sandboxCsp = `default-src 'none'; script-src 'self'; worker-src 'self'; frame-ancestors ${editorOrigin}; base-uri 'none'; form-action 'none'`
const workerCsp = "default-src 'none'; script-src 'unsafe-eval'; connect-src 'none'; worker-src 'none'; base-uri 'none'"

function headers(origin) {
  return (request, response, next) => {
    if (request.headers.host !== new URL(origin).host) return response.sendStatus(403)
    response.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    })
    next()
  }
}
app.disable('x-powered-by')
sandbox.disable('x-powered-by')
app.use(headers(editorOrigin))
sandbox.use(headers(sandboxOrigin))
app.use((_request, response, next) => { response.set('Content-Security-Policy', editorCsp); next() })
sandbox.use((_request, response, next) => { response.set('Content-Security-Policy', sandboxCsp); next() })
app.use('/assets', express.static(join(dist, 'assets'), { immutable: true, maxAge: '365d' }))
sandbox.use('/assets', express.static(join(dist, 'assets'), {
  immutable: true, maxAge: '365d',
  setHeaders(response, path) {
    if (basename(path).startsWith('sandbox-worker-')) response.setHeader('Content-Security-Policy', workerCsp)
  },
}))

function renderHtml(template, variables) {
  return (_request, response) => {
    const html = Object.entries(variables).reduce((result, [key, value]) => result.replace(key, value), template)
    response.set('Cache-Control', 'no-store').type('html').send(html)
  }
}

function authorized(value) {
  return typeof value === 'string' && value.length === token.length &&
    Buffer.byteLength(value) === token.length && timingSafeEqual(Buffer.from(value), Buffer.from(token))
}
app.use('/api', (request, response, next) => {
  const origin = request.get('Origin')
  if (origin && origin !== editorOrigin) return response.sendStatus(403)
  if (request.get('Sec-Fetch-Site') === 'cross-site' || request.get('Sec-Fetch-Site') === 'same-site') return response.sendStatus(403)
  const header = request.get('Authorization')?.replace(/^Bearer /, '')
  const query = request.method === 'GET' ? request.query.access : undefined
  if (!authorized(header) && !authorized(query)) return response.sendStatus(401)
  response.set('Cache-Control', 'no-store')
  next()
}, express.json({ limit: '3mb' }))

function publish(snapshot) {
  for (const response of listeners.get(snapshot.id) || []) response.write(`data: ${JSON.stringify({ revision: snapshot.revision })}\n\n`)
  return snapshot
}

async function apply(projectId, input) {
  const pending = prepareEdit(projectId, input)
  if (pending.replay) return pending.replay
  const codeIds = input.edits.flatMap(edit => edit.type === 'saveCode' ? [edit.file.id] : edit.type === 'deleteCode' ? [edit.id] : [])
  if (codeIds.length) await validateCode(pending.next, codeIds)
  return publish(commitEdit(projectId, input, pending.next, pending.fingerprint))
}

app.get('/api/projects', (_request, response) => response.json({ projects: listProjects() }))
app.post('/api/projects', (request, response) => response.status(201).json(createProject(settings.partial().parse(request.body))))
app.get('/api/projects/:projectId', (request, response) => response.json(getProject(id.parse(request.params.projectId))))
app.post('/api/projects/:projectId/edit', async (request, response) => {
  const projectId = id.parse(request.params.projectId)
  const input = batch.parse(request.body)
  if (input.edits.some(edit => edit.type === 'addAsset')) throw new HttpError(400, 'Use the media import tool to add assets.')
  response.json(await apply(projectId, input))
})

app.post('/api/projects/:projectId/history', (request, response) => {
  const projectId = id.parse(request.params.projectId)
  const input = z.object({ revision, direction: z.enum(['undo', 'redo']) }).parse(request.body)
  response.json(publish(travelHistory(projectId, input.revision, input.direction)))
})

app.get('/api/projects/:projectId/events', (request, response) => {
  const projectId = id.parse(request.params.projectId)
  const current = getProject(projectId)
  response.set({ 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  response.flushHeaders()
  const projectListeners = listeners.get(projectId) || new Set()
  projectListeners.add(response)
  listeners.set(projectId, projectListeners)
  response.write(`data: ${JSON.stringify({ revision: current.revision })}\n\n`)
  const ping = setInterval(() => response.write(': keepalive\n\n'), 15_000)
  response.on('close', () => {
    clearInterval(ping)
    projectListeners.delete(response)
    if (!projectListeners.size) listeners.delete(projectId)
  })
})

async function addMedia(projectId, revision, path, name, signal) {
  const snapshot = getProject(projectId, revision)
  const asset = await ingestMedia(projectId, path, name, snapshot.project.fps, signal)
  try {
    signal?.throwIfAborted()
    return await apply(projectId, { revision, label: `Import ${asset.name}`.slice(0, 120), edits: [{ type: 'addAsset', asset }] })
  } catch (error) {
    await discardMedia(projectId, asset).catch(() => {})
    throw error
  }
}

const upload = multer({ dest: stagingDir, limits: { fileSize: uploadLimit, files: 1, fields: 2, fieldSize: 256 } })
app.post('/api/projects/:projectId/media', upload.single('file'), async (request, response) => {
  if (!request.file) throw new HttpError(400, 'Choose a media file to import.')
  const controller = new AbortController()
  const stop = () => { if (!response.writableEnded) controller.abort(new Error('Media import interrupted.')) }
  response.once('close', stop)
  try {
    const projectId = id.parse(request.params.projectId)
    const baseRevision = z.string().regex(/^\d+$/).transform(Number).pipe(revision).parse(request.body.revision)
    const name = Buffer.from(request.file.originalname, 'latin1').toString('utf8')
    response.json(await addMedia(projectId, baseRevision, request.file.path, name, controller.signal))
  } finally {
    response.removeListener('close', stop)
    await rm(request.file.path, { force: true })
  }
})

app.post('/api/projects/:projectId/inbox', async (request, response) => {
  const projectId = id.parse(request.params.projectId)
  const input = z.object({ revision, name: z.string().min(1).max(260).regex(/^[^/\\:\u0000-\u001f]+$/) }).parse(request.body)
  if (input.name === '.' || input.name === '..' || /[. ]$/.test(input.name)) throw new HttpError(400, 'Use a filename in the Framewell inbox.')
  const source = join(inboxDir, input.name)
  let actual
  try {
    if (!(await lstat(source)).isFile()) throw new Error('Not a regular file.')
    actual = await realpath(source)
    if (dirname(actual).toLowerCase() !== (await realpath(inboxDir)).toLowerCase()) throw new Error('Outside the inbox.')
  } catch {
    throw new HttpError(404, 'Copy that media file into the Framewell inbox first.')
  }
  response.json(await addMedia(projectId, input.revision, actual, input.name))
})

app.get('/api/projects/:projectId/media/:assetId/:variant', (request, response) => {
  const snapshot = getProject(id.parse(request.params.projectId))
  const asset = snapshot.project.assets.find(asset => asset.id === request.params.assetId)
  if (!asset) throw new HttpError(404, 'The media is unavailable.')
  const paths = assetPaths(snapshot.id, asset)
  if (request.params.variant === 'thumb' && asset.kind !== 'audio') return response.type('image/jpeg').sendFile(paths.thumb)
  if (request.params.variant === 'preview') return response.type(previewMime(asset)).sendFile(paths.preview)
  throw new HttpError(404, 'The media rendition is unavailable.')
})
app.get('/api/render-media/:projectId/:assetId', (request, response) => {
  const projectId = id.parse(request.params.projectId)
  const assetId = id.parse(request.params.assetId)
  response.type('image/png').sendFile(join(mediaDir, projectId, assetId, 'preview.png'))
})

app.get('/api/projects/:projectId/code/:fileId/bundle', async (request, response) => {
  const snapshot = getProject(id.parse(request.params.projectId))
  const fileId = id.parse(request.params.fileId)
  response.json(await compileCode(snapshot.project, fileId))
})

app.post('/api/projects/:projectId/code/:fileId/run', async (request, response) => {
  const projectId = id.parse(request.params.projectId)
  const fileId = id.parse(request.params.fileId)
  const input = z.object({ revision, at: frame, label: label.optional() }).parse(request.body)
  const snapshot = getProject(projectId, input.revision)
  const edits = await runScript(snapshot, token, fileId, input.at)
  response.json(await apply(projectId, { revision: input.revision, label: input.label || 'Run layer script', edits }))
})

app.get('/api/projects/:projectId/frame/:frame', async (request, response) => {
  const snapshot = getProject(id.parse(request.params.projectId))
  const at = z.string().regex(/^\d+$/).transform(Number).pipe(frame).parse(request.params.frame)
  const data = await getFrame(snapshot, token, at)
  response.json({ frame: at, revision: snapshot.revision, mimeType: 'image/jpeg', data })
})

app.post('/api/projects/:projectId/exports', (request, response) => {
  const input = z.object({ revision }).parse(request.body)
  const snapshot = getProject(id.parse(request.params.projectId), input.revision)
  response.status(202).json(startExport(snapshot, token))
})
app.get('/api/projects/:projectId/exports/:jobId', (request, response) => {
  response.json(getExport(id.parse(request.params.projectId), id.parse(request.params.jobId)))
})
app.post('/api/projects/:projectId/exports/:jobId/cancel', (request, response) => {
  response.json(cancelExport(id.parse(request.params.projectId), id.parse(request.params.jobId)))
})
app.get('/api/projects/:projectId/exports/:jobId/download', (request, response) => {
  const job = getExport(id.parse(request.params.projectId), id.parse(request.params.jobId))
  if (job.status !== 'complete') throw new HttpError(409, 'This export is incomplete.')
  response.download(exportPath(job), job.name)
})

app.use('/api', (_request, response) => response.status(404).json({ error: 'Unknown editor endpoint.' }))
app.use((error, _request, response, next) => {
  if (response.headersSent) return next(error)
  if (error instanceof z.ZodError) {
    return response.status(400).json({ error: error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('\n') })
  }
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return response.status(413).json({ error: 'The file is larger than 8 GB.' })
  }
  const status = error.status || (error.code === 'ENOENT' ? 404 : 400)
  response.status(status).json({ error: error.message, ...error.details })
})

async function listen(app, origin) {
  const { hostname, port } = new URL(origin)
  const server = createServer(app)
  server.requestTimeout = 0
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(Number(port), hostname, resolve)
  })
  return server
}

const [editorHtml, rendererHtml, sandboxHtml] = await Promise.all(['index.html', 'render.html', 'sandbox.html'].map(name =>
  readFile(join(dist, name), 'utf8').catch(error => {
    if (error.code === 'ENOENT') throw new Error('The editor build is missing. Run npm run build first.')
    throw error
  }),
))
const editorVariables = { __FRAMEWELL_TOKEN__: token, __FRAMEWELL_SANDBOX__: sandboxOrigin }
app.get('/', renderHtml(editorHtml, editorVariables))
app.get('/render.html', renderHtml(rendererHtml, editorVariables))
sandbox.get('/sandbox.html', renderHtml(sandboxHtml, { __FRAMEWELL_EDITOR__: editorOrigin }))

await Promise.all([dataDir, inboxDir, mediaDir, stagingDir].map(path => mkdir(path, { recursive: true })))
const editorServer = await listen(app, editorOrigin)
let sandboxServer
try {
  sandboxServer = await listen(sandbox, sandboxOrigin)
  await recoverExports()
  await writeFile(runtimeFile + '.new', JSON.stringify({ origin: editorOrigin, token }), { mode: 0o600 })
  await rename(runtimeFile + '.new', runtimeFile)
} catch (error) {
  editorServer.close()
  sandboxServer?.close()
  throw error
}
console.log(`Framewell is ready at ${editorOrigin}`)

let stopping = false
async function shutdown() {
  if (stopping) return
  stopping = true
  editorServer.close()
  sandboxServer.close()
  for (const responses of listeners.values()) for (const response of responses) response.end()
  await stopExports()
  await closeRenderer()
  await rm(runtimeFile, { force: true })
  editorServer.closeAllConnections()
  sandboxServer.closeAllConnections()
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
