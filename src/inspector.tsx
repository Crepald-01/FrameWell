import { useEffect, useState, type ReactNode } from 'react'
import { AudioLines, ChevronDown, ChevronUp, Diamond, Film, LockKeyhole, SlidersHorizontal, SquareCode } from 'lucide-react'
import { animated, type Clip, type Edit, type Easing, type Project, type Property, type Track } from '../shared/model'

type Props = {
  project: Project; clip?: Clip; track?: Track; frame: number; blocked: boolean;
  onEdit: (label: string, edits: Edit[]) => unknown; onCode: (id: string) => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="inspector-section"><h3>{title}</h3>{children}</section>
}

export function NumberField({ value, min, max, step = 1, onValue, name }: {
  value: number; min?: number; max?: number; step?: number; onValue: (value: number) => unknown; name?: string;
}) {
  const [draft, setDraft] = useState(String(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => { if (!focused) setDraft(String(value)) }, [value, focused])
  return <input type="number" value={draft} min={min} max={max} step={step} aria-label={name}
    onFocus={() => setFocused(true)} onChange={event => setDraft(event.target.value)}
    onBlur={event => {
      const number = event.currentTarget.valueAsNumber
      setFocused(false)
      if (Number.isFinite(number) && event.currentTarget.validity.valid && number !== value) onValue(number)
    }}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault()
      if (event.key === 'Escape') event.currentTarget.value = String(value)
      event.currentTarget.blur()
    } }} />
}

export function TextField({ value, onValue, multiline = false, name, maxLength = 160 }: {
  value: string; onValue: (value: string) => unknown; multiline?: boolean; name?: string; maxLength?: number;
}) {
  const [draft, setDraft] = useState(value)
  const [focused, setFocused] = useState(false)
  useEffect(() => { if (!focused) setDraft(value) }, [value, focused])
  const common = {
    'aria-label': name, value: draft, maxLength,
    onFocus: () => setFocused(true),
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.target.value),
    onBlur: (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setFocused(false)
      if (event.currentTarget.value !== value) onValue(event.currentTarget.value)
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.key === 'Escape' || (event.key === 'Enter' && !multiline)) {
        event.preventDefault()
        if (event.key === 'Escape') event.currentTarget.value = value
        event.currentTarget.blur()
      }
    },
  }
  return multiline ? <textarea {...common} rows={3} /> : <input {...common} type="text" />
}

function ColorField({ value, onValue }: { value: string; onValue: (value: string) => unknown }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return <span className="color-field">
    <input aria-label="Color" type="color" value={draft} onChange={event => setDraft(event.target.value)}
      onBlur={event => { if (event.currentTarget.value !== value) onValue(event.currentTarget.value) }} />
    <TextField value={value} name="Hex color" maxLength={7} onValue={value => {
      if (/^#[a-f\d]{6}$/i.test(value)) onValue(value)
    }} />
  </span>
}

export function Inspector({ project, clip, track, frame, blocked, onEdit, onCode }: Props) {
  const asset = project.assets.find(asset => asset.id === clip?.assetId)
  const patchClip = (label: string, changes: Partial<Clip>) =>
    clip && onEdit(label, [{ type: 'changeClip', id: clip.id, changes }])
  const patchStyle = (label: string, changes: Partial<Clip['style']>) =>
    clip && patchClip(label, { style: { ...clip.style, ...changes } })
  const patchTrack = (label: string, changes: Partial<Pick<Track, 'name'>>) =>
    track && onEdit(label, [{ type: 'updateTrack', id: track.id, changes }])
  const disabled = blocked || Boolean(clip && track?.locked)
  const projectSettings = !clip && !track
  const at = clip ? frame - clip.start + clip.offset : 0
  const inClip = Boolean(clip && at >= clip.offset && at < clip.offset + clip.duration)
  return <aside className="panel inspector">
    <header className="panel-header"><SlidersHorizontal size={15} /><h2>Inspector</h2>{clip && track?.locked && <LockKeyhole size={14} className="locked-icon" />}</header>
    <div className="inspector-scroll">
      {projectSettings && <fieldset disabled={blocked}>
        <Section title="Composition">
          <label className="field"><span>Name</span><TextField value={project.name} maxLength={100} onValue={name => onEdit('Rename project', [{ type: 'settings', changes: { name } }])} /></label>
          <div className="two-col">
            <label className="field"><span>Width</span><NumberField value={project.width} min={320} max={3840} step={2}
              onValue={width => onEdit('Set composition width', [{ type: 'settings', changes: { width } }])} /></label>
            <label className="field"><span>Height</span><NumberField value={project.height} min={320} max={3840} step={2}
              onValue={height => onEdit('Set composition height', [{ type: 'settings', changes: { height } }])} /></label>
          </div>
          <label className="field"><span>Frame rate</span><input value={`${project.fps} fps`} readOnly /></label>
          <div className="field"><span>Background</span><ColorField value={project.background}
            onValue={background => onEdit('Set composition background', [{ type: 'settings', changes: { background } }])} /></div>
        </Section>
      </fieldset>}
      {!clip && track && <fieldset disabled={blocked}>
        <Section title={track.kind === 'visual' ? 'Video track' : 'Audio track'}>
          <label className="field"><span>Name</span><TextField value={track.name} maxLength={100} onValue={name => patchTrack('Rename track', { name })} /></label>
          <div className="field"><span>Layer order</span><div className="two-col">
            <button className="button" disabled={track.locked || project.tracks[0]?.id === track.id}
              onClick={() => onEdit('Move track up', [{ type: 'moveTrack', id: track.id, before: project.tracks[project.tracks.indexOf(track) - 1]?.id }])}><ChevronUp size={14} /> Up</button>
            <button className="button" disabled={track.locked || project.tracks.at(-1)?.id === track.id}
              onClick={() => onEdit('Move track down', [{ type: 'moveTrack', id: track.id, before: project.tracks[project.tracks.indexOf(track) + 2]?.id }])}><ChevronDown size={14} /> Down</button>
          </div></div>
        </Section>
      </fieldset>}
      {clip && <fieldset disabled={disabled} key={clip.id}>
        <Section title="Clip">
          <label className="field"><span>Name</span><TextField value={clip.name} onValue={name => patchClip('Rename clip', { name })} /></label>
          <div className="two-col">
            <label className="field"><span>Start <small>frames</small></span><NumberField value={clip.start} min={0} max={2_160_000 - clip.duration}
              onValue={start => patchClip('Move clip start', { start })} /></label>
            <label className="field"><span>Length <small>frames</small></span><NumberField value={clip.duration} min={1}
              max={Math.min(2_160_000 - clip.start, (asset && asset.kind !== 'image' ? asset.duration : 2_160_000) - clip.offset)}
              onValue={duration => patchClip('Change clip length', { duration })} /></label>
          </div>
          {(clip.kind === 'video' || clip.kind === 'audio') && asset && <label className="field"><span>Source in <small>frames</small></span>
            <NumberField value={clip.offset} min={0} max={asset.duration - clip.duration} onValue={offset => patchClip('Change source offset', { offset })} />
          </label>}
        </Section>
        {clip.kind !== 'audio' && <Section title="Transform">
          {([['x', 'Position X', 'px', -8192, 8192, 1], ['y', 'Position Y', 'px', -8192, 8192, 1],
            ['scale', 'Scale', '%', 0, 2000, 100], ['rotation', 'Rotation', '°', -360000, 360000, 1],
            ['opacity', 'Opacity', '%', 0, 100, 100]] as const).map(([property, name, unit, min, max, factor]) => {
            const keys = clip.keys[property] || []
            const key = keys.find(key => key.frame === at)
            const value = animated(clip, property, inClip ? at : clip.offset)
            const setKey = (property: Property, value: number, ease: Easing = key?.ease || 'linear') => onEdit(`Set ${name.toLowerCase()} keyframe`,
              [{ type: 'setKey', id: clip.id, property, key: { frame: at, value, ease } }])
            return <div className="property" key={property}>
              <label className="property-line"><span>{name}</span>
                <NumberField value={Math.round(value * factor * 100) / 100} min={min} max={max} step={0.01}
                  onValue={value => {
                    if (inClip && keys.length) setKey(property, value / factor)
                    else patchClip(`Set ${name.toLowerCase()}`, { transform: { ...clip.transform, [property]: value / factor } })
                  }} />
                <small>{unit}</small>
              </label>
              <button className={`key-button ${key ? 'key-set' : ''} ${keys.length ? 'has-keys' : ''}`} disabled={!inClip}
                title={key ? `Remove ${name} keyframe` : `Add ${name} keyframe`} aria-label={key ? `Remove ${name} keyframe` : `Add ${name} keyframe`}
                onClick={() => key ? onEdit('Remove keyframe', [{ type: 'deleteKey', id: clip.id, property, frame: at }]) : setKey(property, value)}>
                <Diamond size={14} fill={key ? 'currentColor' : 'none'} />
              </button>
              {key && <label className="ease-row"><span>Easing</span><select value={key.ease} onChange={event => setKey(property, key.value, event.target.value as Easing)}>
                <option value="linear">Linear</option><option value="ease-in">Ease in</option><option value="ease-out">Ease out</option>
                <option value="ease-in-out">Ease in and out</option><option value="hold">Hold</option>
              </select></label>}
            </div>
          })}
        </Section>}
        {clip.kind === 'text' && <Section title="Text">
          <label className="field"><span>Content</span><TextField value={clip.style.text} multiline maxLength={4000} onValue={text => patchStyle('Edit text', { text })} /></label>
          <div className="two-col">
            <label className="field"><span>Typeface</span><select value={clip.style.fontFamily}
              onChange={event => patchStyle('Set text typeface', { fontFamily: event.target.value as Clip['style']['fontFamily'] })}>
              <option>Arial</option><option>Georgia</option><option>Consolas</option></select></label>
            <label className="field"><span>Size</span><NumberField value={clip.style.fontSize} min={8} max={768} onValue={fontSize => patchStyle('Set text size', { fontSize })} /></label>
          </div>
          <div className="field"><span>Fill</span><ColorField value={clip.style.fill} onValue={fill => patchStyle('Set text fill', { fill })} /></div>
          <label className="check"><input type="checkbox" checked={clip.style.bold} onChange={event => patchStyle('Set text weight', { bold: event.target.checked })} /> Bold</label>
        </Section>}
        {clip.kind === 'shape' && <Section title="Shape">
          <div className="two-col">
            <label className="field"><span>Width</span><NumberField value={clip.style.width} min={1} max={3840} onValue={width => patchStyle('Set shape width', { width })} /></label>
            <label className="field"><span>Height</span><NumberField value={clip.style.height} min={1} max={3840} onValue={height => patchStyle('Set shape height', { height })} /></label>
          </div>
          <label className="field"><span>Corner radius</span><NumberField value={clip.style.radius} min={0} max={1920} onValue={radius => patchStyle('Round shape corners', { radius })} /></label>
          <div className="field"><span>Fill</span><ColorField value={clip.style.fill} onValue={fill => patchStyle('Set shape fill', { fill })} /></div>
        </Section>}
        {(clip.kind === 'video' || clip.kind === 'image') && <Section title="Framing">
          <label className="field"><span><Film size={12} /> Fit</span><select value={clip.style.fit}
            onChange={event => patchStyle('Set media framing', { fit: event.target.value as Clip['style']['fit'] })}>
            <option value="contain">Contain</option><option value="cover">Cover</option>
          </select></label>
        </Section>}
        {asset?.hasAudio && <Section title="Audio">
          <label className="field"><span><AudioLines size={12} /> Gain (%)</span><NumberField value={Math.round(clip.style.volume * 100)} min={0} max={200}
            onValue={volume => patchStyle('Set clip gain', { volume: volume / 100 })} /></label>
          <div className="two-col">
            <label className="field"><span>Fade in <small>frames</small></span><NumberField value={clip.style.fadeIn} min={0} max={clip.duration}
              onValue={fadeIn => patchStyle('Set audio fade in', { fadeIn })} /></label>
            <label className="field"><span>Fade out <small>frames</small></span><NumberField value={clip.style.fadeOut} min={0} max={clip.duration}
              onValue={fadeOut => patchStyle('Set audio fade out', { fadeOut })} /></label>
          </div>
          <label className="check"><input type="checkbox" checked={clip.style.muted} onChange={event => patchStyle('Mute clip', { muted: event.target.checked })} /> Mute clip</label>
        </Section>}
        {clip.kind === 'react' && <Section title="React">
          {Object.entries(clip.props).map(([name, value]) => <label className="field" key={name}><span>{name}</span>
            {typeof value === 'boolean'
              ? <input type="checkbox" checked={value} onChange={event => patchClip('Set component prop', { props: { ...clip.props, [name]: event.target.checked } })} />
              : typeof value === 'number'
                ? <NumberField value={value} step={0.01} onValue={value => patchClip('Set component prop', { props: { ...clip.props, [name]: value } })} />
                : <TextField value={value} maxLength={4000} onValue={value => patchClip('Set component prop', { props: { ...clip.props, [name]: value } })} />}
          </label>)}
          <button className="button" type="button" onClick={() => clip.codeId && onCode(clip.codeId)}><SquareCode size={15} /> Open source</button>
        </Section>}
      </fieldset>}
    </div>
  </aside>
}
