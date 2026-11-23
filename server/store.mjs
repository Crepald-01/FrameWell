import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { applyEdits, newProject, project } from '../shared/model.ts'
import { dataDir } from './config.mjs'

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message)
    this.status = status
    this.details = details
  }
}

mkdirSync(dataDir, { recursive: true })
const db = new DatabaseSync(join(dataDir, 'framewell.sqlite'))
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = FULL;
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL,
    document TEXT NOT NULL,
    undo TEXT NOT NULL,
    redo TEXT NOT NULL,
    last_edit TEXT NOT NULL,
    updated TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS requests (
    project_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    revision INTEGER NOT NULL,
    PRIMARY KEY (project_id, request_id)
  );
  CREATE TABLE IF NOT EXISTS exports (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    status TEXT NOT NULL,
    done INTEGER NOT NULL,
    total INTEGER NOT NULL,
    name TEXT NOT NULL,
    error TEXT
  );
`)

const rowFor = db.prepare('SELECT * FROM projects WHERE id = ?')
const insertProject = db.prepare('INSERT INTO projects VALUES (?, 0, ?, ?, ?, ?, ?)')
const updateProject = db.prepare('UPDATE projects SET revision = ?, document = ?, undo = ?, redo = ?, last_edit = ?, updated = ? WHERE id = ?')
const requestFor = db.prepare('SELECT fingerprint, revision FROM requests WHERE project_id = ? AND request_id = ?')
const insertRequest = db.prepare('INSERT INTO requests VALUES (?, ?, ?, ?)')
const pruneRequests = db.prepare('DELETE FROM requests WHERE project_id = ? AND revision < ?')
const maxHistory = 80

function row(id) {
  const result = rowFor.get(id)
  if (!result) throw new HttpError(404, 'Project not found.')
  return result
}

function snapshot(row) {
  return {
    id: row.id, revision: row.revision, project: JSON.parse(row.document),
    canUndo: row.undo !== '[]', canRedo: row.redo !== '[]', lastEdit: row.last_edit,
  }
}

function requireRevision(row, revision) {
  if (row.revision !== revision) {
    throw new HttpError(409, 'The project changed. Refresh and retry the edit.', { revision: row.revision })
  }
}

function transaction(action) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = action()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function listProjects() {
  return db.prepare("SELECT id, json_extract(document, '$.name') AS name, updated FROM projects ORDER BY updated DESC").all()
}

export function createProject(settings) {
  const id = crypto.randomUUID()
  const value = project.parse(newProject(settings))
  insertProject.run(id, JSON.stringify(value), '[]', '[]', 'Created project', new Date().toISOString())
  return getProject(id)
}

export function getProject(id, revision) {
  const projectRow = row(id)
  if (revision !== undefined) requireRevision(projectRow, revision)
  return snapshot(projectRow)
}

function replayRequest(projectRow, input, fingerprint) {
  if (!input.requestId) return
  const previous = requestFor.get(projectRow.id, input.requestId)
  if (!previous) return
  if (previous.fingerprint !== fingerprint) throw new HttpError(409, 'This request ID has already been used for another edit.')
  return snapshot(projectRow)
}

export function prepareEdit(id, input) {
  const projectRow = row(id)
  const fingerprint = input.requestId ? createHash('sha256').update(JSON.stringify(input)).digest('hex') : ''
  const replay = replayRequest(projectRow, input, fingerprint)
  if (replay) return { replay }
  requireRevision(projectRow, input.revision)
  return { fingerprint, next: applyEdits(JSON.parse(projectRow.document), input.edits) }
}

export function commitEdit(id, input, next, fingerprint) {
  return transaction(() => {
    const projectRow = row(id)
    const replay = replayRequest(projectRow, input, fingerprint)
    if (replay) return replay
    requireRevision(projectRow, input.revision)
    const undo = [...JSON.parse(projectRow.undo), { label: input.label, document: projectRow.document }].slice(-maxHistory)
    const revision = projectRow.revision + 1
    updateProject.run(revision, JSON.stringify(next), JSON.stringify(undo), '[]', input.label, new Date().toISOString(), id)
    if (input.requestId) {
      insertRequest.run(id, input.requestId, fingerprint, revision)
      pruneRequests.run(id, revision - 250)
    }
    return getProject(id)
  })
}

export function travelHistory(id, revision, direction) {
  return transaction(() => {
    const projectRow = row(id)
    requireRevision(projectRow, revision)
    const undo = JSON.parse(projectRow.undo)
    const redo = JSON.parse(projectRow.redo)
    const entry = (direction === 'undo' ? undo : redo).pop()
    if (!entry) return snapshot(projectRow)
    const destination = direction === 'undo' ? redo : undo
    destination.push({ label: entry.label, document: projectRow.document })
    const prefix = direction === 'undo' ? 'Undo' : 'Redo'
    updateProject.run(projectRow.revision + 1, entry.document, JSON.stringify(undo), JSON.stringify(redo),
      `${prefix} · ${entry.label}`, new Date().toISOString(), id)
    return getProject(id)
  })
}

export function saveExport(job) {
  db.prepare(`INSERT INTO exports VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET status = excluded.status, done = excluded.done, error = excluded.error`)
    .run(job.id, job.projectId, job.revision, job.status, job.done, job.total, job.name, job.error || null)
}

export function getExport(projectId, id) {
  const job = db.prepare('SELECT id, project_id AS projectId, revision, status, done, total, name, error FROM exports WHERE project_id = ? AND id = ?')
    .get(projectId, id)
  if (!job) throw new HttpError(404, 'Export not found.')
  return job
}

export function interruptExports() {
  const stale = db.prepare("SELECT id, name FROM exports WHERE status IN ('rendering', 'queued')").all()
  db.prepare("UPDATE exports SET status = 'error', error = 'The editor stopped during export.' WHERE status IN ('rendering', 'queued')").run()
  return stale
}
