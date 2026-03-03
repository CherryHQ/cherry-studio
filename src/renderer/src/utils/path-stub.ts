/**
 * Minimal browser-compatible stub for Node.js 'path' module
 * This provides basic path utilities for code-inspector-plugin
 * and other tools that expect a path module in browser context.
 */

function extname(path: string): string {
  const index = path.lastIndexOf('.')
  const lastIndex = path.lastIndexOf('/')
  return index > lastIndex && index > 0 ? path.slice(index) : ''
}

function basename(path: string, ext?: string): string {
  const index = path.lastIndexOf('/')
  const base = index > -1 ? path.slice(index + 1) : path
  if (ext && base.endsWith(ext)) {
    return base.slice(0, -ext.length)
  }
  return base
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/')
  return index > -1 ? path.slice(0, index) : ''
}

function join(...segments: string[]): string {
  return segments.filter(Boolean).join('/').replace(/\/+/g, '/')
}

function normalize(path: string): string {
  return path.replace(/\/+/g, '/').replace(/\/\.$/, '/')
}

function resolve(...segments: string[]): string {
  let result = join(...segments)
  if (result.startsWith('./')) {
    result = result.slice(2)
  }
  return result
}

export default {
  extname,
  basename,
  dirname,
  join,
  normalize,
  resolve,
  sep: '/',
  delimiter: ':',
  posix: { extname, basename, dirname, join, normalize, resolve, sep: '/' },
  win32: null
}
