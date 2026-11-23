import type { Asset, Edit, ExportJob, ProjectSummary, Revision, Settings } from '../shared/model'

export function config(name: string) {
  return document.querySelector<HTMLMetaElement>(`meta[name="framewell-${name}"]`)?.content || ''
}

export function access(path: string) {
  return `${path}?${new URLSearchParams({ access: config('token') })}`
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const form = body instanceof FormData
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${config('token')}`,
      ...(form || body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: form ? body : body === undefined ? undefined : JSON.stringify(body),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(response.status, result.error || `Framewell returned HTTP ${response.status}.`)
  return result
}

export const projectPath = (id: string) => `/api/projects/${id}`
export const projects = () => api<{ projects: ProjectSummary[] }>('/api/projects')
export const openProject = (id: string) => api<Revision>(projectPath(id))
export const createProject = (settings: Partial<Settings>) => api<Revision>('/api/projects', settings)
export const commit = (snapshot: Revision, label: string, edits: Edit[]) =>
  api<Revision>(projectPath(snapshot.id) + '/edit', { revision: snapshot.revision, label, edits, requestId: crypto.randomUUID() })
export const history = (snapshot: Revision, direction: 'undo' | 'redo') =>
  api<Revision>(projectPath(snapshot.id) + '/history', { revision: snapshot.revision, direction })
export const mediaUrl = (id: string, asset: Asset, variant = 'preview') =>
  access(`${projectPath(id)}/media/${asset.id}/${variant}`)
export const exportStatus = (id: string, job: string) => api<ExportJob>(`${projectPath(id)}/exports/${job}`)
