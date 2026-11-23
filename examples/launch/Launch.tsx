import { clamp, easeOut, lerp } from '@framewell/sdk'

export const defaults = { beat: 'opening', headline: '', accent: '#c7b4ff' }

const ink = '#101017'
const white = '#f7f4ff'
const muted = '#a6a0ba'
const mint = '#91e1cc'
const rose = '#eeb1c6'
const sans = '"Segoe UI Variable Display", "Segoe UI", Arial, sans-serif'
const mono = '"Cascadia Mono", Consolas, monospace'
const enter = (frame, start, length) => easeOut((frame - start) / length)
const px = (value) => Math.round(value * 10) / 10

function Box({ x, y, w, h, style = {}, children }) {
  return <div style={{ position: 'absolute', boxSizing: 'border-box', left: x, top: y, width: w, height: h, ...style }}>{children}</div>
}

function Label({ children, color = muted, size = 20, style = {} }) {
  return <div style={{ color, fontFamily: mono, fontSize: size, fontWeight: 600, letterSpacing: '0.16em', whiteSpace: 'nowrap', ...style }}>{children}</div>
}

function Title({ children, p, size, color = white, height, spacing = '-0.068em' }) {
  return <div style={{ overflow: 'hidden', height: height || size * 1.14 }}>
    <div style={{
      color, fontSize: size, fontWeight: 750, lineHeight: 1, letterSpacing: spacing, whiteSpace: 'nowrap',
      transform: `translateY(${px((1 - p) * size * 1.22)}px)`, opacity: Math.min(1, p * 2.5),
    }}>{children}</div>
  </div>
}

function Mark({ size, accent, style = {} }) {
  return <div style={{
    width: size, height: size, display: 'grid', placeItems: 'center', borderRadius: size * 0.235,
    color: '#211635', background: accent, ...style,
  }}>
    <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="none" stroke="#211635"
      strokeWidth="1.95" strokeLinecap="round" strokeLinejoin="round">
      <path d="m4 11 16-3.5-1-3.1a2 2 0 0 0-2.35-1.42L3.8 5.8a2 2 0 0 0-1.48 2.42L3 11" />
      <path d="m6 5.3 2.7 4.3M12 4l2.7 4.3M3 11h18v7.7a2.3 2.3 0 0 1-2.3 2.3H5.3A2.3 2.3 0 0 1 3 18.7Z" />
    </svg>
  </div>
}

function Guide({ accent, frame, center = false }) {
  const x = center ? 960 : 1485
  return <>
    <Box x={0} y={0} w={1920} h={1080} style={{
      background: `radial-gradient(ellipse at ${center ? 50 : 80}% 48%, #2c203d 0%, #1a1526 24%, ${ink} 66%)`,
    }} />
    <Box x={0} y={0} w={1920} h={1080} style={{
      backgroundImage: 'linear-gradient(to right, #c4afff12 1px, transparent 1px), linear-gradient(to bottom, #c4afff12 1px, transparent 1px)',
      backgroundSize: '96px 96px', backgroundPosition: `${px((frame * 0.35) % 96)}px 0px`,
      opacity: center ? 0.34 : 0.52,
    }} />
    <Box x={x} y={0} w={1} h={1080} style={{ background: `linear-gradient(transparent, ${accent}50, transparent)`, opacity: 0.45 }} />
    <Box x={154} y={113} w={1612} h={1} style={{ background: '#bfaeff2e' }} />
    <Box x={154} y={970} w={1612} h={1} style={{ background: '#bfaeff2e' }} />
  </>
}

function Opening({ frame, accent, headline }) {
  const art = enter(frame, 0, 27)
  const sweep = enter(frame, 2, 56)
  return <>
    <Guide accent={accent} frame={frame} />
    <Box x={186} y={148}><Label color={accent}>FRAMEWELL</Label></Box>
    <Box x={176} y={300} w={1050}>
      <Title size={166} p={enter(frame, 1, 23)}>{headline || 'Make it'}</Title>
      <Title size={214} p={enter(frame, 7, 23)} color={accent} height={239}>move.</Title>
    </Box>
    <Box x={192} y={801} style={{ opacity: enter(frame, 19, 25) }}>
      <div style={{ color: muted, fontSize: 34, letterSpacing: '-0.018em' }}>A workspace for video and motion.</div>
    </Box>
    {[486, 584, 692].map((size, index) => <Box key={size} x={1485 - size / 2} y={533 - size / 2} w={size} h={size} style={{
      boxShadow: `inset 0 0 0 1px ${index === 0 ? '#c7b4ff55' : '#c7b4ff28'}`, borderRadius: '50%',
      opacity: art * (1 - index * 0.14), transform: `scale(${0.72 + art * 0.28})`,
    }} />)}
    <Box x={1230} y={302} style={{
      transform: `translateY(${px((1 - art) * 78)}px) rotate(${px(-7 + art * 2)}deg) scale(${0.84 + art * 0.16})`,
      opacity: Math.min(1, art * 3),
    }}>
      <Mark size={463} accent={accent} style={{ boxShadow: '0 38px 120px #070610b0, 0 0 72px #c7b4ff30' }} />
    </Box>
    <Box x={1154} y={821} w={646} h={3} style={{ background: '#6e6082' }}>
      <div style={{ height: 3, width: `${sweep * 100}%`, background: accent }} />
      <Box x={sweep * 646 - 5} y={-4} w={11} h={11} style={{ background: white, transform: 'rotate(45deg)' }} />
    </Box>
    <Box x={1544} y={914}><Label size={17}>MOTION / EDIT</Label></Box>
  </>
}

const rows = [
  { title: 'Video', spans: [[19, 376], [408, 497], [920, 243]], color: '#4b3870', border: '#9376c7' },
  { title: 'Titles', spans: [[173, 383], [622, 468]], color: '#5d344a', border: '#bf7897' },
  { title: 'Audio', spans: [[19, 1071]], color: '#234d47', border: '#5caa98' },
]

function Cut({ frame, accent, headline }) {
  const plate = enter(frame, 1, 27)
  const playhead = lerp(344, 1399, clamp((frame - 5) / 87))
  return <>
    <Guide accent={accent} frame={frame + 66} />
    <Box x={186} y={145}><Label color={accent}>THE TIMELINE</Label></Box>
    <Box x={177} y={198} w={1550}>
      <Title size={120} p={enter(frame, 0, 24)}>{headline || 'Cut. Layer. Animate.'}</Title>
    </Box>
    <Box x={185} y={400} w={1550} h={476} style={{
      opacity: Math.min(1, plate * 2.4), transform: `translateY(${px((1 - plate) * 72)}px)`,
      border: '1px solid #594a6f', borderRadius: 28, background: '#191821',
      boxShadow: '0 28px 90px #090710a8', overflow: 'hidden',
    }}>
      <Box x={0} y={0} w={1550} h={83} style={{ borderBottom: '1px solid #493d58', background: '#23202e' }}>
        <Box x={34} y={27}><Label color={white} size={20}>COMPOSITION</Label></Box>
        <Box x={1230} y={27}><Label size={20} color={accent}>00:0{Math.floor((frame + 66) / 30)}:{String((frame + 66) % 30).padStart(2, '0')}</Label></Box>
      </Box>
      <Box x={207} y={83} w={1342} h={392} style={{
        backgroundImage: 'linear-gradient(to right, #8d79a82c 1px, transparent 1px)',
        backgroundSize: '146px 100%',
      }} />
      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(tick => <Box x={224 + 146 * tick} y={101} key={tick}>
        <Label size={16} color="#a59ab8">0{tick}s</Label>
      </Box>)}
      {rows.map((row, index) => {
        const y = 146 + index * 100
        const rowIn = enter(frame, 7 + index * 4, 23)
        return <Box key={row.title} x={0} y={y} w={1550} h={100} style={{ borderTop: '1px solid #393047' }}>
          <Box x={33} y={34}><Label size={20} color={index === 2 ? mint : '#c4b8d5'}>{row.title.toUpperCase()}</Label></Box>
          {row.spans.map(([start, length], number) => <Box key={start} x={207 + start} y={15} w={length * rowIn} h={69} style={{
            background: row.color, border: `1px solid ${row.border}`, borderRadius: 12, overflow: 'hidden',
          }}>
            {index !== 2 && <Box x={17} y={16}><Label color={index === 1 ? '#ffdeeb' : '#ede2ff'} size={16}>
              {index === 1 ? (number === 0 ? 'TITLE IN' : 'KEYFRAMES') : ['INTRO', 'B-ROLL', 'OUTRO'][number]}
            </Label></Box>}
            {index === 1 && number === 1 && [78, 165, 262, 374].map((x, idx) => <Box key={x} x={x} y={48} w={8} h={8} style={{
              background: playhead > 207 + start + x ? white : rose, transform: 'rotate(45deg)',
              opacity: enter(frame, 20 + idx * 4, 14),
            }} />)}
            {index === 2 && <Box x={18} y={10} w={1024} h={49} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {Array.from({ length: 111 }, (_, i) => <div key={i} style={{
                width: 4, height: 4 + 36 * Math.abs(Math.sin(i * 1.45) * Math.cos(i * 0.17)),
                borderRadius: 2, background: mint, opacity: 0.45 + 0.25 * Math.sin(i * 0.73),
              }} />)}
            </Box>}
          </Box>)}
        </Box>
      })}
      <Box x={playhead} y={85} w={2} h={390} style={{ background: accent, boxShadow: '0 0 15px #bd92ff88' }}>
        <Box x={-7} y={4} w={16} h={19} style={{ background: accent, clipPath: 'polygon(0 0,100% 0,100% 65%,50% 100%,0 65%)' }} />
      </Box>
    </Box>
  </>
}

function Agent({ frame, accent, headline }) {
  const plate = enter(frame, 0, 24)
  const result = enter(frame, 25, 18)
  const command = 'Fade in the title.'
  return <>
    <Guide accent={accent} frame={frame + 156} />
    <Box x={186} y={148}><Label color={mint}>MODEL CONTEXT PROTOCOL</Label></Box>
    <Box x={178} y={288} w={775}>
      <Title size={151} p={enter(frame, 1, 23)} color={mint}>{headline || 'AI in'}</Title>
      <Title size={151} p={enter(frame, 5, 23)}>the edit.</Title>
    </Box>
    <Box x={189} y={666} w={700} style={{ opacity: enter(frame, 19, 22) }}>
      <div style={{ color: muted, fontSize: 34, letterSpacing: '-0.016em' }}>Ask your AI to make the next move.</div>
    </Box>
    <Box x={982} y={251} w={743} h={568} style={{
      background: '#201b2d', border: '1px solid #5c4b70', borderRadius: 28, overflow: 'hidden',
      boxShadow: '0 26px 92px #070611a6',
      transform: `translateX(${px((1 - plate) * 112)}px)`, opacity: Math.min(1, plate * 2.5),
    }}>
      <Box x={34} y={32} w={50} h={50} style={{ display: 'grid', placeItems: 'center', background: '#34274a', borderRadius: 13, color: accent }}>
        <div style={{ fontFamily: mono, fontSize: 26, fontWeight: 700 }}>⌘</div>
      </Box>
      <Box x={107} y={44}><Label color={white}>MCP CLIENT</Label></Box>
      <Box x={608} y={48}><Label size={16} color={mint}>LOCAL</Label></Box>
      <Box x={34} y={114} w={675} h={93} style={{
        display: 'flex', alignItems: 'center', gap: 18, padding: '0 24px', background: '#15121f', borderRadius: 16,
        boxShadow: 'inset 0 0 0 1px #66547e', color: white, fontFamily: mono, fontSize: 31, fontWeight: 500,
      }}>
        <span style={{ color: accent }}>{'›'}</span><span>{command.slice(0, Math.min(command.length, Math.floor((frame + 1) * 1.25)))}</span>
        <span style={{ width: 2, height: 28, background: accent, opacity: frame < 32 && Math.floor(frame / 5) % 2 === 0 ? 1 : 0 }} />
      </Box>
      <Box x={34} y={247} w={675} h={177} style={{
        background: '#171620', border: '1px solid #4b3f5e', borderRadius: 17, opacity: result,
        transform: `translateY(${px((1 - result) * 23)}px)`,
      }}>
        <Box x={22} y={22}><Label size={17}>TITLE / OPACITY</Label></Box>
        <Box x={105} y={99} w={442} h={2} style={{ background: `linear-gradient(90deg,${accent}44,${accent})` }} />
        <Box x={95} y={90} w={19} h={19} style={{ transform: 'rotate(45deg)', background: '#4e3d66', border: `2px solid ${accent}` }} />
        <Box x={529} y={90} w={19} h={19} style={{ transform: 'rotate(45deg)', background: accent }} />
        <Box x={22} y={86}><Label color={muted} size={19}>0%</Label></Box>
        <Box x={566} y={86}><Label color={white} size={19}>100%</Label></Box>
      </Box>
      <Box x={35} y={467} w={673} h={62} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', opacity: enter(frame, 37, 15) }}>
        <div style={{ color: mint, fontSize: 23, fontWeight: 660 }}>✓ &nbsp;2 keyframes added</div>
        <div style={{ color: accent, boxShadow: 'inset 0 0 0 1px #63517c', borderRadius: 9, padding: '7px 15px', fontSize: 21, fontWeight: 650 }}>Undo</div>
      </Box>
    </Box>
  </>
}

function Signature({ frame, accent, headline }) {
  const mark = enter(frame, 0, 25)
  const lockup = enter(frame, 7, 26)
  return <>
    <Guide accent={accent} frame={frame + 230} center />
    {[436, 653, 906].map((size, index) => <Box key={size} x={960 - size / 2} y={510 - size / 2} w={size} h={size} style={{
      boxShadow: 'inset 0 0 0 1px #b59ad744', borderRadius: '50%', opacity: mark * (0.81 - index * 0.21),
      transform: `scale(${0.8 + mark * 0.2})`,
    }} />)}
    <Box x={864} y={239} style={{
      opacity: Math.min(1, mark * 3), transform: `translateY(${px((1 - mark) * 48)}px) scale(${0.8 + mark * 0.2})`,
    }}>
      <Mark size={192} accent={accent} style={{ boxShadow: '0 16px 90px #b093f455, 0 22px 66px #080710' }} />
    </Box>
    <Box x={406} y={472} w={1108} style={{ textAlign: 'center' }}>
      <Title size={174} p={lockup}>{headline || 'Framewell'}</Title>
    </Box>
    <Box x={540} y={703} w={840} style={{
      textAlign: 'center', opacity: enter(frame, 20, 24), transform: `translateY(${px((1 - enter(frame, 20, 24)) * 20)}px)`,
    }}>
      <div style={{ color: accent, fontSize: 40, letterSpacing: '-0.02em', fontWeight: 530 }}>Your edit. In motion.</div>
    </Box>
  </>
}

export default function Launch({ frame, width, height, props }) {
  const { beat, headline, accent = defaults.accent } = props
  const Component = ({ opening: Opening, timeline: Cut, mcp: Agent, signature: Signature })[beat] || Opening
  return <div style={{
    position: 'absolute', inset: 0, width: 1920, height: 1080, overflow: 'hidden',
    transformOrigin: '0 0', transform: `scale(${width / 1920}, ${height / 1080})`,
    background: ink, color: white, fontFamily: sans,
  }}>
    <Component frame={frame} accent={accent} headline={headline} />
  </div>
}
