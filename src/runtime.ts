import { config } from './api'

export type Bundle = {
  key: string; bundle: string; path: string; kind: 'script' | 'react'
}
export type ReactInput = {
  frame: number; fps: number; width: number; height: number; props: Record<string, string | number | boolean>
}
type Reply = { id: number; value?: unknown; error?: string } | { type: 'ready' }

class Sandbox {
  private iframe?: HTMLIFrameElement
  private port?: MessagePort
  private ready?: Promise<MessagePort>
  private serial = 0
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()

  private open() {
    if (this.ready) return this.ready
    const origin = config('sandbox')
    const iframe = document.createElement('iframe')
    iframe.sandbox.add('allow-scripts', 'allow-same-origin')
    iframe.title = 'Project code runtime'
    iframe.hidden = true
    this.iframe = iframe
    const channel = new MessageChannel()
    this.port = channel.port1
    this.ready = new Promise<MessagePort>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.reset(new Error('The code runtime did not start.'))
        reject(new Error('The code runtime did not start.'))
      }, 10_000)
      channel.port1.onmessage = ({ data }: MessageEvent<Reply>) => {
        if (!data || typeof data !== 'object') return
        if ('type' in data) {
          clearTimeout(timeout)
          resolve(channel.port1)
          return
        }
        const request = this.pending.get(data.id)
        if (!request) return
        this.pending.delete(data.id)
        if (data.error) request.reject(new Error(data.error))
        else request.resolve(data.value)
      }
      iframe.onload = () => iframe.contentWindow?.postMessage('framewell-connect', origin, [channel.port2])
      iframe.src = origin + '/sandbox.html'
      document.body.append(iframe)
    })
    return this.ready
  }

  private reset(error: Error) {
    this.iframe?.remove()
    this.port?.close()
    this.iframe = undefined
    this.port = undefined
    this.ready = undefined
    for (const request of this.pending.values()) request.reject(error)
    this.pending.clear()
  }

  private async request<T>(operation: 'build' | 'react' | 'defaults', compiled: Bundle, input: unknown): Promise<T> {
    const port = await this.open()
    const id = ++this.serial
    return new Promise((resolve, reject) => {
      const handle = window.setTimeout(() => this.reset(new Error(`Code timed out in ${compiled.path}.`)), 5000)
      this.pending.set(id, {
        resolve(value) { clearTimeout(handle); resolve(value as T) },
        reject(error) { clearTimeout(handle); reject(error) },
      })
      try {
        port.postMessage({ id, operation, compiled, input })
      } catch (error) {
        this.pending.delete(id)
        clearTimeout(handle)
        reject(error)
      }
    })
  }

  render(compiled: Bundle, input: ReactInput) {
    return this.request<string>('react', compiled, input)
  }

  build(compiled: Bundle, input: unknown) {
    return this.request('build', compiled, input)
  }

  defaults(compiled: Bundle) {
    return this.request<ReactInput['props']>('defaults', compiled, null)
  }
}

export const runtime = new Sandbox()
