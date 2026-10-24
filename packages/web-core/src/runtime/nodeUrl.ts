// Browser `node:url` subset: the Worker's paths are absolute POSIX paths under `/web`.
export function fileURLToPath(url: string | URL): string {
  const parsed = typeof url === 'string' ? new URL(url) : url
  if (parsed.protocol !== 'file:') throw new TypeError(`The URL must be of scheme file: ${parsed.href}`)
  return decodeURIComponent(parsed.pathname)
}

export function pathToFileURL(path: string): URL {
  return new URL(`file://${encodeURI(path).replace(/[?#]/g, encodeURIComponent)}`)
}

const BrowserURL = globalThis.URL
export { BrowserURL as URL }

export default { fileURLToPath, pathToFileURL, URL: BrowserURL }
