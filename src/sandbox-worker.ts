import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Bundle, ReactInput } from './runtime'

type Module = {
  default?: React.ComponentType<ReactInput>
  build?: (input: unknown) => unknown
  defaults?: Record<string, unknown>
}
type Request = { id: number; operation: 'build' | 'react' | 'defaults'; compiled: Bundle; input: ReactInput }
type Factory = (react: typeof React, jsx: typeof jsxRuntime) => Module
const factories = new Map<string, Factory>()
const worker = self as unknown as {
  postMessage(message: unknown): void
  onmessage?: (message: MessageEvent<Request>) => void
}
const send = worker.postMessage.bind(worker)

worker.onmessage = async ({ data }) => {
  const { id, compiled, input, operation } = data
  try {
    let load = factories.get(compiled.key)
    if (!load) {
      load = new Function('framewellReact', 'framewellJSX', compiled.bundle + '\nreturn FramewellProject;') as Factory
      factories.set(compiled.key, load)
      if (factories.size > 30) {
        const oldest = factories.keys().next().value
        if (oldest) factories.delete(oldest)
      }
    }
    const module = load(React, jsxRuntime)
    if (operation === 'defaults') {
      const entries = Object.entries(module.defaults || {}).slice(0, 50).filter(([key, value]) =>
        /^[a-zA-Z_]\w{0,63}$/.test(key) && (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) ||
          typeof value === 'string' && value.length <= 4000))
      send({ id, value: Object.fromEntries(entries) })
      return
    }
    if (operation === 'build') {
      if (typeof module.build !== 'function') throw new Error('Export a build(context) function from the script.')
      const result = JSON.stringify(await module.build(input))
      if (!result || result.length > 2_000_000) throw new Error('The script must return up to 2 MB of editable layer data.')
      send({ id, value: JSON.parse(result) })
      return
    }
    if (!module.default) throw new Error('Export the React component as default.')
    const image = renderToStaticMarkup(React.createElement(module.default, input))
    if (image.length > 400_000) throw new Error('This React frame is too large to display.')
    send({ id, value: image })
  } catch (error) {
    send({ id, error: error instanceof Error ? error.message : String(error) })
  }
}
