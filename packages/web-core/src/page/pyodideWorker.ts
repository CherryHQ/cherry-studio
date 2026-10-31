// Stand-in for `pyodide.worker?worker`: the unmodified desktop Pyodide worker, started inside a sandboxed
// iframe. Its opaque origin keeps Python away from the app's OPFS, IndexedDB and storage.
import pyodideWorkerUrl from '@renderer/workers/pyodide.worker?worker&url'

// WebKit starts no blob Worker in an opaque origin, so the worker comes from a `data:` URL.
const FRAME_HTML = `<script>
let worker
onmessage = ({ source, data }) => {
  if (source !== parent) return
  if (!worker) {
    worker = new Worker('data:text/javascript;charset=utf-8,' + encodeURIComponent(data.script))
    worker.onmessage = (event) => parent.postMessage({ data: event.data }, '*')
  } else worker.postMessage(data.data)
}
parent.postMessage({ ready: true }, '*')
</script>`

/** The part of a `Worker` that the desktop `PyodideService` uses. */
export default class SandboxedPyodideWorker extends EventTarget {
  onmessage: ((event: MessageEvent) => void) | null = null
  readonly #frame = document.createElement('iframe')
  readonly #started: Promise<void>
  #markStarted!: () => void

  constructor() {
    super()
    this.#started = new Promise((resolve) => (this.#markStarted = resolve))
    window.addEventListener('message', this.#receive)
    this.#frame.sandbox.add('allow-scripts')
    this.#frame.hidden = true
    this.#frame.srcdoc = FRAME_HTML
    document.body.append(this.#frame)
  }

  postMessage(data: unknown): void {
    void this.#started.then(() => this.#frame.contentWindow?.postMessage({ data }, '*'))
  }

  terminate(): void {
    window.removeEventListener('message', this.#receive)
    this.#frame.remove()
  }

  readonly #receive = async ({ source, data }: MessageEvent) => {
    if (source !== this.#frame.contentWindow) return
    if (data.ready) {
      const script = await (await fetch(pyodideWorkerUrl)).text()
      this.#frame.contentWindow?.postMessage({ script }, '*')
      this.#markStarted()
      return
    }
    const event = new MessageEvent('message', { data: data.data })
    this.onmessage?.(event)
    this.dispatchEvent(event)
  }
}
