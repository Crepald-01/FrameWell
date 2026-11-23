import { useEffect, useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { syntaxTree } from '@codemirror/language'
import { linter, type Diagnostic } from '@codemirror/lint'
import { Braces, CircleAlert, FileCode2, Play, Plus, Save, SquareCode, Trash2 } from 'lucide-react'
import type { CodeFile, Edit, Revision } from '../shared/model'
import { starter } from './starter-code'

export type ChangeResult = { ok: true; snapshot: Revision } | { ok: false; error: string }
type Draft = { file: CodeFile; basedOn: string }
type Props = {
  snapshot: Revision; visible: boolean; selected: string; blocked: boolean; onSelect: (id: string) => void;
  onWrite: (name: string, edits: Edit[]) => Promise<ChangeResult>; onRun: (id: string) => Promise<ChangeResult>;
  onInsert: (id: string) => void;
}
const extensions = [
  javascript({ typescript: true, jsx: true }),
  linter(view => {
    const problems: Diagnostic[] = []
    syntaxTree(view.state).iterate({ enter(node) {
      if (!node.type.isError || problems.length >= 60) return
      problems.push({ from: node.from, to: Math.min(view.state.doc.length, Math.max(node.from + 1, node.to)),
        severity: 'error', message: 'Unexpected or incomplete syntax' })
    } })
    return problems
  }),
]
const fingerprints = (file?: CodeFile) => file ? JSON.stringify([file.path, file.kind, file.source]) : ''
const modeNames = { script: 'Layer script', react: 'React clip', module: 'Module' }

function storedDrafts(key: string): Record<string, Draft> {
  try { return JSON.parse(localStorage.getItem(key) || '{}') } catch { return {} }
}

export function CodeRoom({ snapshot, visible, selected, blocked, onSelect, onWrite, onRun, onInsert }: Props) {
  const draftKey = `framewell.drafts.${snapshot.id}`
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => storedDrafts(draftKey))
  const [diagnostic, setDiagnostic] = useState('')
  const files = snapshot.project.code
  const shown = useMemo(() => [...files, ...Object.values(drafts).filter(({ file }) => !files.some(saved => saved.id === file.id)).map(({ file }) => file)], [files, drafts])
  const active = selected ? shown.find(file => file.id === selected) : shown[0]
  const file = active && (drafts[active.id]?.file || active)
  const saved = files.find(file => file.id === active?.id)
  const dirty = Boolean(file && fingerprints(file) !== fingerprints(saved))
  const changedElsewhere = Boolean(file && drafts[file.id] && drafts[file.id].basedOn !== fingerprints(saved))

  useEffect(() => {
    try { localStorage.setItem(draftKey, JSON.stringify(drafts)) } catch { /* Draft remains open in this tab. */ }
  }, [draftKey, drafts])
  useEffect(() => setDiagnostic(''), [selected])

  function modify(changes: Partial<CodeFile>) {
    if (!file) return
    setDrafts(value => ({ ...value, [file.id]: {
      file: { ...file, ...changes },
      basedOn: value[file.id]?.basedOn ?? fingerprints(saved),
    } }))
  }

  function clear(id: string) {
    setDrafts(current => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)))
    setDiagnostic('')
  }

  function add(kind: CodeFile['kind']) {
    const file = starter(kind, shown)
    setDrafts(current => ({ ...current, [file.id]: { file, basedOn: '' } }))
    onSelect(file.id)
  }

  async function save() {
    if (!file || blocked || !dirty) return
    setDiagnostic('')
    const result = await onWrite(`Save ${file.path}`.slice(0, 120), [{ type: 'saveCode', file }])
    if (result.ok) {
      setDrafts(current => {
        const draft = current[file.id]
        if (fingerprints(draft?.file) !== fingerprints(file) && draft) {
          return { ...current, [file.id]: { ...draft, basedOn: fingerprints(file) } }
        }
        return Object.fromEntries(Object.entries(current).filter(([key]) => key !== file.id))
      })
    } else setDiagnostic(result.error)
  }

  async function run() {
    if (!file || dirty || blocked) return
    setDiagnostic('')
    const result = await onRun(file.id)
    if (!result.ok) setDiagnostic(result.error)
  }

  async function remove() {
    if (!file || blocked) return
    if (saved) {
      const result = await onWrite('Delete code file', [{ type: 'deleteCode', id: file.id }])
      if (!result.ok) { setDiagnostic(result.error); return }
    }
    clear(file.id)
    onSelect('')
  }

  return <div className="code-room" hidden={!visible} onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save() }
  }}>
    <aside className="panel code-files">
      <header className="panel-header"><FileCode2 size={15} /><h2>Project files</h2></header>
      <div className="file-list">
        {shown.map(original => {
          const candidate = drafts[original.id]?.file || original
          const Icon = candidate.kind === 'react' ? SquareCode : Braces
          return <button key={candidate.id} className="file-item" aria-pressed={file?.id === candidate.id} title={candidate.path}
            onClick={() => onSelect(candidate.id)}><Icon size={15} /><span>{candidate.path}</span>
            {drafts[candidate.id] && <i className="dirty-dot" aria-label="Unsaved draft" />}
          </button>
        })}
      </div>
      <div className="new-code">
        {(Object.keys(modeNames) as CodeFile['kind'][]).map(kind =>
          <button className="button" disabled={blocked} key={kind} onClick={() => add(kind)}><Plus size={14} /> {modeNames[kind]}</button>)}
      </div>
    </aside>
    <main className="panel code-workspace">
      {file ? <>
        <header className="code-toolbar">
          <FileCode2 size={16} />
          <input aria-label="Source file path" value={file.path} maxLength={180} spellCheck={false}
            onChange={event => modify({ path: event.target.value })} />
          <span className="code-mode-label">{modeNames[file.kind]}</span>
          <span className="toolbar-spacer" />
          {saved && dirty && <button className="button quiet" disabled={blocked} onClick={() => clear(file.id)}>Discard draft</button>}
          <button className="button" disabled={blocked || !dirty} onClick={() => void save()}><Save size={14} /> {changedElsewhere ? 'Replace saved' : 'Save'}</button>
          {file.kind === 'script' && <button className="button primary" title="Insert generated layers at the playhead" disabled={blocked || dirty}
            onClick={() => void run()}><Play size={14} /> Run script</button>}
          {file.kind === 'react' && <button className="button primary" disabled={blocked || dirty}
            onClick={() => onInsert(file.id)}><Plus size={15} /> Add to timeline</button>}
          <button className="icon-button" title="Delete code file" aria-label="Delete code file" disabled={blocked}
            onClick={() => void remove()}><Trash2 size={15} /></button>
        </header>
        {changedElsewhere && <div className="code-notice" role="status"><CircleAlert size={15} /> The saved source changed while this draft was open.</div>}
        <div className="source-editor">
          <CodeMirror key={file.id} value={file.source} theme="dark" height="100%" extensions={extensions} onChange={source => modify({ source })}
            basicSetup={{ foldGutter: true, bracketMatching: true, autocompletion: true }} aria-label="Source editor" />
        </div>
        {diagnostic && <pre className="code-diagnostic" role="alert">{diagnostic}</pre>}
        <footer className="code-status"><span>{file.path.endsWith('.tsx') ? 'TypeScript JSX' : 'TypeScript'}</span><span>{dirty ? 'Unsaved draft' : 'Saved'}</span></footer>
      </> : <div className="empty code-empty">
        <SquareCode size={36} strokeWidth={1.3} />
        <h2>Author a composition in code</h2>
        <p>Generate editable layers with a script or add a React component as a clip.</p>
        <div className="button-group"><button className="button" onClick={() => add('script')}><Plus size={15} /> Layer script</button>
          <button className="button primary" onClick={() => add('react')}><Plus size={15} /> React clip</button></div>
      </div>}
    </main>
  </div>
}
