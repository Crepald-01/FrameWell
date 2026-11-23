import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { batch, frame, id, label, revision, settings } from '../shared/model.ts'
import { editorOrigin, inboxDir, runtimeFile } from './config.mjs'

const server = new McpServer({ name: 'framewell', version: '0.1.0' })
const project = { projectId: id }
const current = { ...project, revision }
const job = { ...project, jobId: id }
const endpoint = projectId => '/api/projects/' + projectId

async function api(path, body) {
  let connection
  try {
    connection = JSON.parse(await readFile(runtimeFile, 'utf8'))
  } catch {
    throw new Error('Start the Framewell local service first with npm start.')
  }
  if (connection.origin !== editorOrigin || typeof connection.token !== 'string') throw new Error('Framewell connection settings are invalid.')
  const response = await fetch(editorOrigin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer ' + connection.token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  }).catch(error => { throw new Error(`Could not reach the Framewell service. ${error.message}`) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ? JSON.stringify(result) : `Framewell returned HTTP ${response.status}.`)
  return result
}

function tool(name, description, schema, handler, readOnlyHint = false) {
  server.registerTool(name, { description, inputSchema: schema, annotations: { readOnlyHint } }, async input => {
    try {
      const result = await handler(input)
      if (result.image) {
        return { content: [
          { type: 'text', text: `Frame ${result.frame} at revision ${result.revision}.` },
          { type: 'image', data: result.image, mimeType: result.mimeType },
        ] }
      }
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result }
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error.message }] }
    }
  })
}

tool('list_projects', 'List local Framewell projects and their IDs.', {}, () => api('/api/projects'), true)
tool('create_project', 'Create an empty Framewell composition. Default 1920×1080 at 30 fps.', settings.partial().shape, input => api('/api/projects', input))
tool('get_project', 'Read the current revision, tracks, clips, media metadata and TypeScript/React project sources. Time values are integer frames.', project,
  ({ projectId }) => api(endpoint(projectId)), true)
tool('apply_edits', 'Apply one atomic batch of timeline or code edits with a named Undo entry. Read the latest revision with get_project. Track order is topmost first. Use a requestId to safely retry the same batch.',
  { ...project, ...batch.shape }, ({ projectId, ...body }) => api(endpoint(projectId) + '/edit', body))
tool('undo_redo', 'Move one step through the shared project edit history.', { ...current, direction: z.enum(['undo', 'redo']) },
  ({ projectId, ...body }) => api(endpoint(projectId) + '/history', body))
tool('import_media', `Import a media file by its filename from the local Framewell inbox at ${inboxDir}. The file becomes a project asset.`,
  { ...current, name: z.string().max(260) }, ({ projectId, ...body }) => api(endpoint(projectId) + '/inbox', body))
tool('run_layer_script', 'Run a saved TypeScript layer script and insert its editable layers at a frame. Returns the updated project.',
  { ...current, fileId: id, at: frame, label: label.optional() }, ({ projectId, fileId, ...body }) =>
    api(`${endpoint(projectId)}/code/${fileId}/run`, body))
tool('inspect_frame', 'Render one composition frame as a JPEG for visual inspection. Uses the video composition only.', { ...project, frame },
  async ({ projectId, frame }) => {
    const { data, ...result } = await api(endpoint(projectId) + '/frame/' + frame)
    return { ...result, image: data }
  }, true)
tool('start_export', 'Queue a local MP4 export at the supplied project revision. Returns a job ID.', current,
  ({ projectId, revision }) => api(endpoint(projectId) + '/exports', { revision }))
tool('get_export', 'Read an export job status, progress, and local output filename.', job,
  ({ projectId, jobId }) => api(`${endpoint(projectId)}/exports/${jobId}`), true)
tool('cancel_export', 'Cancel a pending or rendering export job.', job,
  ({ projectId, jobId }) => api(`${endpoint(projectId)}/exports/${jobId}/cancel`, {}))

await server.connect(new StdioServerTransport())
