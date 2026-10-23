// The sandboxed frame's only script, kept apart so the build can allow it in the CSP by its hash.
// WebKit starts no blob Worker in an opaque origin, so the worker comes from a `data:` URL.
export const PYODIDE_FRAME_SCRIPT = `
let worker
onmessage = ({ source, data }) => {
  if (source !== parent) return
  if (!worker) {
    worker = new Worker('data:text/javascript;charset=utf-8,' + encodeURIComponent(data.script))
    worker.onmessage = (event) => parent.postMessage({ data: event.data }, '*')
  } else worker.postMessage(data.data)
}
parent.postMessage({ ready: true }, '*')
`
