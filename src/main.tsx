import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowDownToLine, Cable, Check, ChevronDown, CircleAlert, Clapperboard, FilePlus2, Layers3, LoaderCircle, PanelLeft, PanelRight, Plus, Redo2, SquareCode, Undo2, X } from 'lucide-react'
import { durationOf, getClip, newClip, placeClip, type Edit, type ExportJob, type ProjectSummary, type Revision, type Settings } from '../shared/model'
import { access, api, ApiError, commit, createProject, exportStatus, history, mediaUrl, openProject, projectPath, projects } from './api'
import type { ChangeResult } from './code-room'
import { Inspector } from './inspector'
import { Library } from './library'
import { runtime, type Bundle } from './runtime'
import { resumePreviewAudio, type SceneSources } from './scene'
import { clipActions, Timeline } from './timeline'
import { Viewer } from './viewer'
import './studio.css'

const acceptFiles = '.mp4,.mov,.m4v,.mkv,.webm,.avi,.mp3,.m4a,.wav,.flac,.ogg,.opus,.aac,.png,.jpg,.jpeg,.webp'
const CodeRoom = lazy(() => import('./code-room').then(module => ({ default: module.CodeRoom })))
type Workbench = 'edit' | 'code'
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

function App() {
  const [snapshot, setSnapshot] = useState<Revision>()
  const [projectList, setProjectList] = useState<ProjectSummary[]>([])
  const [ready, setReady] = useState(false)
  const [workbench, setWorkbench] = useState<Workbench>('edit')
  const [codeOpened, setCodeOpened] = useState(false)
  const [selected, setSelected] = useState('')
  const [selectedTrack, setSelectedTrack] = useState('')
  const [fileId, setFileId] = useState('')
  const [at, setAt] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [bundles, setBundles] = useState<Record<string, Bundle>>({})
  const [activeJob, setActiveJob] = useState<ExportJob>()
  const [exportOpen, setExportOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [timelineHeight, setTimelineHeight] = useState(294)
  const [compactPanel, setCompactPanel] = useState<'none' | 'media' | 'inspector'>('none')
  const snapshotRef = useRef<Revision | undefined>(undefined)
  const atRef = useRef(0)
  const busyRef = useRef(false)
  const stageLoad = useRef(0)
  const picker = useRef<HTMLInputElement>(null)
  const resize = useRef<{ y: number; height: number } | undefined>(undefined)

  function sync(incoming: Revision, switchProject = false) {
    const current = snapshotRef.current
    if (current && !switchProject && (current.id !== incoming.id || current.revision > incoming.revision)) return
    snapshotRef.current = incoming
    setSnapshot(incoming)
    setProjectList(existing => existing.map(project => project.id === incoming.id ? { ...project, name: incoming.project.name } : project))
  }

  function setFrame(frame: number) {
    atRef.current = Math.max(0, Math.min(2_160_000, frame))
    setAt(atRef.current)
  }

  function seek(frame: number) {
    setPlaying(false)
    setFrame(frame)
  }

  function select(clip: string, track: string) {
    setSelected(clip)
    setSelectedTrack(track)
  }

  function activate(target: Revision) {
    sync(target, true)
    localStorage.setItem('framewell.project', target.id)
    setActiveJob(undefined)
    const savedJob = localStorage.getItem(`framewell.export.${target.id}`)
    if (savedJob) void exportStatus(target.id, savedJob).then(job => {
      if (snapshotRef.current?.id === target.id) setActiveJob(existing => existing || job)
    }).catch(() => {})
    setBundles({})
    seek(0)
    select('', '')
    setFileId('')
    setWorkbench('edit')
  }

  useEffect(() => {
    let active = true
    const load = async () => {
      const { projects: list } = await projects()
      if (!active) return
      setProjectList(list)
      const target = list.find(item => item.id === localStorage.getItem('framewell.project')) || list[0]
      if (!target) return
      const targetProject = await openProject(target.id)
      if (active) activate(targetProject)
    }
    void load().catch(error => { if (active) setError(message(error)) }).finally(() => { if (active) setReady(true) })
    return () => { active = false }
  }, [])

  const projectId = snapshot?.id
  useEffect(() => {
    if (!projectId) return
    const events = new EventSource(access(projectPath(projectId) + '/events'))
    events.onmessage = event => {
      const latest = Number(JSON.parse(event.data).revision)
      const current = snapshotRef.current
      if (current?.id !== projectId || current.revision >= latest) return
      void openProject(projectId).then(sync).catch(error => setError(message(error)))
    }
    return () => events.close()
  }, [projectId])

  const codeVersion = JSON.stringify(snapshot?.project.code || [])
  useEffect(() => {
    if (!projectId) return
    const files = (JSON.parse(codeVersion) as Revision['project']['code']).filter(file => file.kind === 'react')
    const generation = ++stageLoad.current
    void Promise.all(files.map(async file => [file.id, await api<Bundle>(`${projectPath(projectId)}/code/${file.id}/bundle`)] as const))
      .then(result => { if (stageLoad.current === generation) setBundles(Object.fromEntries(result)) })
      .catch(error => { if (stageLoad.current === generation) setError(message(error)) })
    return () => { stageLoad.current++ }
  }, [projectId, codeVersion])

  const project = snapshot?.project
  const length = project ? durationOf(project) : 0
  useEffect(() => {
    if (!playing || !project) return
    const started = performance.now()
    const base = atRef.current
    let animation = 0
    function tick(now: number) {
      const next = Math.min(Math.max(0, length - 1), base + Math.floor((now - started) * project!.fps / 1000))
      if (next !== atRef.current) setFrame(next)
      if (next >= length - 1) setPlaying(false)
      else animation = requestAnimationFrame(tick)
    }
    animation = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animation)
  }, [playing, project?.fps, length])

  function play() {
    if (!length) return
    if (playing) { setPlaying(false); return }
    if (atRef.current >= length - 1) setFrame(0)
    void resumePreviewAudio().catch(() => {})
    setPlaying(true)
  }

  async function work<T>(label: string, action: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
    if (busyRef.current) return { ok: false, error: 'Another edit is being saved.' }
    setError('')
    busyRef.current = true
    setBusy(label)
    try {
      return { ok: true, value: await action() }
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && snapshotRef.current) {
        await openProject(snapshotRef.current.id).then(sync).catch(() => {})
      }
      const text = message(error)
      setError(text)
      return { ok: false, error: text }
    } finally {
      setBusy('')
      busyRef.current = false
    }
  }

  async function update(label: string, action: (active: Revision) => Promise<Revision>): Promise<ChangeResult> {
    if (!snapshot) return { ok: false, error: 'Open a project first.' }
    const result = await work(label, () => action(snapshot))
    if (!result.ok) return result
    sync(result.value)
    return { ok: true, snapshot: result.value }
  }

  function write(label: string, edits: Edit[]) {
    return update('Saving…', active => commit(active, label, edits))
  }

  function moveHistory(direction: 'undo' | 'redo') {
    if (!snapshot || !(direction === 'undo' ? snapshot.canUndo : snapshot.canRedo)) return
    void update('Saving…', active => history(active, direction))
  }

  async function switchProject(id: string) {
    if (id === projectId) return
    const result = await work('Opening project…', () => openProject(id))
    if (result.ok) activate(result.value)
  }

  async function addProject(settings: Partial<Settings>) {
    const result = await work('Creating project…', () => createProject(settings))
    if (!result.ok) return
    setProjectList(existing => [{ id: result.value.id, name: result.value.project.name, updated: new Date().toISOString() }, ...existing])
    activate(result.value)
    setNewOpen(false)
  }

  async function handleFiles(files: FileList) {
    if (!snapshot || !files.length) return
    const selectedFiles = Array.from(files)
    const base = snapshot
    await work(selectedFiles.length > 1 ? `Importing ${selectedFiles.length} files…` : 'Importing media…', async () => {
      let current = base
      for (const file of selectedFiles) {
        const data = new FormData()
        data.set('revision', String(current.revision))
        data.set('file', file)
        current = await api<Revision>(projectPath(current.id) + '/media', data)
        sync(current)
      }
    })
  }

  async function putClip(clip: ReturnType<typeof newClip>, preferred = selectedTrack) {
    if (!project) return
    const placement = placeClip(project, clip, preferred)
    const first = placement[0]
    const track = first.type === 'addTrack' ? first.track.id : first.type === 'addClip' ? first.trackId : ''
    const result = await write(`Add ${clip.kind === 'react' ? 'React clip' : clip.kind}`, placement)
    if (result.ok) select(clip.id, track)
  }

  function addMedia(id: string, at = atRef.current, track = selectedTrack) {
    const asset = project?.assets.find(asset => asset.id === id)
    if (!asset || !project) return
    const clip = newClip(asset.kind, asset.name.slice(0, 160), at, asset.kind === 'image' ? project.fps * 4 : asset.duration)
    clip.assetId = asset.id
    void putClip(clip, track)
  }

  function addLayer(kind: 'text' | 'shape') {
    if (!project) return
    const clip = newClip(kind, kind === 'text' ? 'Title' : 'Shape', atRef.current, project.fps * 4)
    clip.style.fontSize = Math.round(project.width * 0.06)
    if (kind === 'shape') {
      clip.style.width = Math.round(project.width * 0.38)
      clip.style.height = Math.round(project.height * 0.34)
      clip.style.fill = '#9d82ff'
    }
    void putClip(clip)
  }

  async function addReact(id: string) {
    const file = project?.code.find(file => file.id === id && file.kind === 'react')
    if (!snapshot || !file) return
    const start = atRef.current
    const result = await update('Preparing React clip…', async active => {
      const bundle = await api<Bundle>(`${projectPath(active.id)}/code/${id}/bundle`)
      const clip = newClip('react', file.path.split('/').at(-1)!.replace(/\.tsx$/, ''), start, active.project.fps * 4)
      clip.codeId = id
      clip.props = await runtime.defaults(bundle)
      const edits = placeClip(active.project, clip, selectedTrack)
      return commit(active, 'Add React clip', edits)
    })
    if (result.ok) setWorkbench('edit')
  }

  async function runCode(id: string) {
    const frame = atRef.current
    const result = await update('Running layer script…', active => api<Revision>(`${projectPath(active.id)}/code/${id}/run`, { revision: active.revision, at: frame }))
    if (result.ok) setWorkbench('edit')
    return result
  }

  async function queueExport() {
    if (!snapshot) return
    const result = await work('Queueing export…', () => api<ExportJob>(projectPath(snapshot.id) + '/exports', { revision: snapshot.revision }))
    if (result.ok) {
      setActiveJob(result.value)
      localStorage.setItem(`framewell.export.${snapshot.id}`, result.value.id)
    }
  }

  const jobId = activeJob?.id
  const jobProjectId = activeJob?.projectId
  const exporting = activeJob?.status === 'queued' || activeJob?.status === 'rendering'
  useEffect(() => {
    if (!jobId || !jobProjectId || !exporting) return
    let stopped = false
    let handle: number
    function poll() {
      void exportStatus(jobProjectId!, jobId!).then(job => {
        if (stopped) return
        setActiveJob(job)
        if (job.status === 'queued' || job.status === 'rendering') handle = window.setTimeout(poll, 850)
      }).catch(() => { if (!stopped) handle = window.setTimeout(poll, 2500) })
    }
    handle = window.setTimeout(poll, 850)
    return () => { stopped = true; clearTimeout(handle) }
  }, [jobId, jobProjectId, exporting])

  async function stopExport() {
    if (!activeJob) return
    const result = await work('Cancelling export…', () =>
      api<ExportJob>(`${projectPath(activeJob.projectId)}/exports/${activeJob.id}/cancel`, {}))
    if (result.ok) setActiveJob(result.value)
  }

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const nativeControl = target?.closest('input, textarea, [contenteditable=true], select, [role=slider], button:not(.clip-body)')
      if (!snapshot || event.defaultPrevented || nativeControl || workbench !== 'edit' || newOpen || exportOpen) return
      if (event.key === ' ' && !event.ctrlKey) { event.preventDefault(); play() }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); seek(atRef.current + (event.key === 'ArrowRight' ? 1 : -1)) }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); moveHistory(event.shiftKey ? 'redo' : 'undo')
      } else if (event.key === 'Delete' || event.key.toLowerCase() === 's') {
        if (event.ctrlKey || event.metaKey || event.altKey || busyRef.current) return
        const actions = clipActions(snapshot.project, selected, atRef.current)
        if (event.key === 'Delete' && actions.remove) { event.preventDefault(); void write('Delete clip', [actions.remove]) }
        if (event.key.toLowerCase() === 's' && actions.split) { event.preventDefault(); void write('Split clip', [actions.split]) }
      } else if (event.key === 'Escape') select('', '')
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  })

  const clip = project && selected ? getClip(project, selected) : undefined
  const track = clip?.track || project?.tracks.find(track => track.id === selectedTrack)
  const sources: SceneSources = {
    media: snapshot ? Object.fromEntries(snapshot.project.assets.map(asset => [asset.id, mediaUrl(snapshot.id, asset)])) : {},
    bundles,
  }
  function workbenchTab(tab: Workbench) {
    setWorkbench(tab)
    if (tab === 'code') { setCodeOpened(true); setPlaying(false) }
  }

  return <div className="studio" style={{ '--timeline-height': `${timelineHeight}px` } as CSSProperties}>
    <header className="topbar">
      <div className="top-left">
        <div className="brand"><span className="brand-mark"><Clapperboard size={20} strokeWidth={2.3} /></span><span>Framewell</span></div>
        <span className="top-divider" />
        {snapshot ? <div className="project-picker">
          <select aria-label="Current project" value={snapshot.id} disabled={Boolean(busy)}
            onChange={event => event.target.value === 'new' ? setNewOpen(true) : void switchProject(event.target.value)}>
            {projectList.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}
            <option value="new">New project…</option>
          </select><ChevronDown size={13} />
        </div> : <button className="button quiet" onClick={() => setNewOpen(true)}><FilePlus2 size={15} /> New project</button>}
      </div>
      <nav className="workspace-tabs" aria-label="Workspace">
        <button className={workbench === 'edit' ? 'active' : ''} aria-pressed={workbench === 'edit'} disabled={!snapshot}
          onClick={() => workbenchTab('edit')}><Layers3 size={16} /> Edit</button>
        <button className={workbench === 'code' ? 'active' : ''} aria-pressed={workbench === 'code'} disabled={!snapshot}
          onClick={() => workbenchTab('code')}><SquareCode size={16} /> Code</button>
      </nav>
      <div className="top-right">
        <div className="compact-tools">
          <button className={`icon-button ${compactPanel === 'media' ? 'active' : ''}`} title="Toggle media panel" aria-label="Toggle media panel"
            aria-pressed={compactPanel === 'media'} onClick={() => setCompactPanel(existing => existing === 'media' ? 'none' : 'media')}><PanelLeft size={16} /></button>
          <button className={`icon-button ${compactPanel === 'inspector' ? 'active' : ''}`} title="Toggle inspector" aria-label="Toggle inspector"
            aria-pressed={compactPanel === 'inspector'} onClick={() => setCompactPanel(existing => existing === 'inspector' ? 'none' : 'inspector')}><PanelRight size={16} /></button>
        </div>
        <button className="icon-button undo-tool" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!snapshot?.canUndo || Boolean(busy)} onClick={() => moveHistory('undo')}><Undo2 size={17} /></button>
        <button className="icon-button undo-tool" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!snapshot?.canRedo || Boolean(busy)} onClick={() => moveHistory('redo')}><Redo2 size={17} /></button>
        <button className="button primary export-trigger" disabled={!snapshot} onClick={() => setExportOpen(true)}><ArrowDownToLine size={16} /> Export</button>
      </div>
    </header>
    {snapshot && project ? <>
      <div className="workspace" hidden={workbench !== 'edit'} data-compact={compactPanel}>
        <Library project={project} projectId={snapshot.id} busy={Boolean(busy)} onImport={() => picker.current?.click()}
          onFiles={files => void handleFiles(files)} onAsset={id => addMedia(id)} onReact={id => void addReact(id)} />
        <Viewer project={project} frame={at} playing={playing && workbench === 'edit'} sources={sources} onSeek={seek} onPlay={play}
          onImport={() => picker.current?.click()} onComposition={() => {
            select('', '')
            if (window.innerWidth < 1060) setCompactPanel('inspector')
          }} />
        <Inspector project={project} clip={clip?.clip} track={track} frame={at} blocked={Boolean(busy)}
          onEdit={write} onCode={id => { setFileId(id); workbenchTab('code') }} />
      </div>
      <div className="timeline-shell" hidden={workbench !== 'edit'}>
        <div className="timeline-resize" role="separator" aria-label="Timeline height" aria-orientation="horizontal" tabIndex={0}
          aria-valuenow={timelineHeight} aria-valuemin={166} aria-valuemax={Math.max(166, Math.round(window.innerHeight * 0.63))}
          onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            setTimelineHeight(height => Math.max(166, Math.min(Math.round(window.innerHeight * 0.63), height + (event.key === 'ArrowUp' ? 20 : -20))))
          } }}
          onPointerDown={event => {
            event.currentTarget.setPointerCapture(event.pointerId)
            resize.current = { y: event.clientY, height: timelineHeight }
          }}
          onPointerUp={() => { resize.current = undefined }}
          onPointerCancel={() => { resize.current = undefined }}
          onPointerMove={event => {
            const start = resize.current
            if (start) setTimelineHeight(Math.max(166, Math.min(Math.round(window.innerHeight * 0.63), start.height + start.y - event.clientY)))
          }} />
        <Timeline key={snapshot.id} project={project} frame={at} selected={selected} selectedTrack={selectedTrack} blocked={Boolean(busy)} onSelect={select}
          onSeek={seek} onEdit={write} onAsset={addMedia} onAdd={addLayer} />
      </div>
      {codeOpened && <Suspense fallback={workbench === 'code' ? <main className="welcome empty">Opening code workspace…</main> : null}>
        <CodeRoom key={snapshot.id} snapshot={snapshot} visible={workbench === 'code'} selected={fileId} blocked={Boolean(busy)}
          onSelect={setFileId} onWrite={write} onRun={runCode} onInsert={id => void addReact(id)} />
      </Suspense>}
    </> : <main className="welcome empty">
      <div className="welcome-mark"><Clapperboard size={34} strokeWidth={1.7} /></div>
      <h1>{ready ? 'Start a new project' : 'Opening Framewell'}</h1>
      {ready && <button className="button primary" onClick={() => setNewOpen(true)}><Plus size={17} /> New project</button>}
    </main>}
    <input ref={picker} type="file" accept={acceptFiles} multiple hidden onChange={event => {
      if (event.target.files) void handleFiles(event.target.files)
      event.target.value = ''
    }} />
    <footer className="statusbar">
      <span aria-live="polite">{busy ? <><LoaderCircle size={13} className="spin" /> {busy}</>
        : snapshot ? <><Check size={14} /> Saved locally</> : <><Check size={14} /> Local workspace</>}</span>
      {snapshot && <span className="last-edit">{snapshot.lastEdit}</span>}
      <span className="toolbar-spacer" />
      <span title="MCP server runs through your configured AI client"><Cable size={14} /> Local MCP</span>
    </footer>
    {error && <div className="toast" role="alert"><CircleAlert size={19} /><span>{error}</span>
      <button className="icon-button" title="Dismiss message" aria-label="Dismiss message" onClick={() => setError('')}><X size={15} /></button></div>}
    {newOpen && <NewProject busy={Boolean(busy)} error={error} onClose={() => { setNewOpen(false); setError('') }} onCreate={settings => void addProject(settings)} />}
    {exportOpen && snapshot && <ExportDialog project={snapshot} length={length} job={activeJob} busy={Boolean(busy)} onClose={() => setExportOpen(false)}
      onStart={() => void queueExport()} onStop={() => void stopExport()} error={error} />}
  </div>
}

function Modal({ id, title, children, onClose }: { id: string; title: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  return <dialog ref={dialog} className="modal" aria-labelledby={id} onCancel={event => { event.preventDefault(); onClose() }}>
    <div className="modal-header"><h2 id={id}>{title}</h2>
      <button className="icon-button" title="Close" aria-label="Close" onClick={onClose}><X size={17} /></button></div>
    {children}
  </dialog>
}

function NewProject({ busy, error, onClose, onCreate }: { busy: boolean; error: string; onClose: () => void; onCreate: (value: Partial<Settings>) => void }) {
  const form = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const [width, height] = String(data.get('size')).split(':').map(Number)
    onCreate({ name: String(data.get('name')), width, height, fps: Number(data.get('fps')) as Settings['fps'] })
  }
  return <Modal id="new-project" title="New project" onClose={onClose}>
    <form onSubmit={form} className="modal-body">
      <label className="field"><span>Project name</span><input name="name" defaultValue="Untitled project" autoFocus required maxLength={100} /></label>
      <div className="two-col">
        <label className="field"><span>Canvas</span><select name="size" defaultValue="1920:1080">
          <option value="1920:1080">Landscape · 1080p</option><option value="1080:1920">Portrait · 1080p</option>
          <option value="1080:1080">Square · 1080p</option><option value="3840:2160">Landscape · 4K</option>
        </select></label>
        <label className="field"><span>Frame rate</span><select name="fps" defaultValue="30">
          <option value="24">24 fps</option><option value="30">30 fps</option><option value="60">60 fps</option>
        </select></label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions"><button className="button" type="button" onClick={onClose}>Cancel</button>
        <button className="button primary" type="submit" disabled={busy}>Create project</button></div>
    </form>
  </Modal>
}

function ExportDialog({ project, length, job, busy, onClose, onStart, onStop, error }: {
  project: Revision; length: number; job?: ExportJob; busy: boolean; onClose: () => void; onStart: () => void; onStop: () => void; error: string;
}) {
  const active = job?.status === 'rendering' || job?.status === 'queued'
  const percent = job ? Math.min(100, Math.floor(job.done / job.total * 100)) : 0
  return <Modal id="export-project" title="Export video" onClose={onClose}>
    <div className="modal-body">
      <div className="export-info"><span>Format</span><strong>MP4 · H.264</strong><span>Composition</span>
        <strong>{project.project.width} × {project.project.height} · {project.project.fps} fps</strong></div>
      {!length && !job && <p className="modal-hint">Add a clip to the timeline to export your composition.</p>}
      {job && <div className="export-job" aria-live="polite">
        <div><strong>{job.status === 'rendering' ? `Rendering · ${percent}%` : job.status === 'queued' ? 'Queued' : job.status === 'complete' ? 'Export complete' : job.status === 'cancelled' ? 'Export cancelled' : 'Export failed'}</strong>
          <small>Revision {job.revision}</small></div>
        {active && <progress value={job.done} max={job.total} aria-label="Export progress" />}
        {job.error && <p className="form-error">{job.error}</p>}
        {job.status === 'complete' && <a className="button" href={access(`${projectPath(job.projectId)}/exports/${job.id}/download`)}>
          <ArrowDownToLine size={15} /> Download MP4</a>}
      </div>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions"><button className="button" onClick={onClose}>Close</button>
        {active ? <button className="button" disabled={busy} onClick={onStop}>Cancel export</button>
          : <button className="button primary" disabled={!length || busy} onClick={onStart}>{job ? 'Export again' : 'Export MP4'}</button>}</div>
    </div>
  </Modal>
}

createRoot(document.getElementById('root')!).render(<App />)
