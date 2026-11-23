const editorOrigin = document.querySelector<HTMLMetaElement>('meta[name="framewell-editor"]')?.content
const connect = (event: MessageEvent) => {
  if (event.origin !== editorOrigin || event.source !== parent || event.data !== 'framewell-connect' || event.ports.length !== 1) return
  window.removeEventListener('message', connect)
  const port = event.ports[0]
  const worker = new Worker(new URL('./sandbox-worker.ts', import.meta.url), { type: 'module' })
  port.onmessage = event => worker.postMessage(event.data)
  worker.onmessage = event => port.postMessage(event.data)
  window.addEventListener('pagehide', () => worker.terminate(), { once: true })
  port.postMessage({ type: 'ready' })
}
window.addEventListener('message', connect)
