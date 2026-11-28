import { AbsoluteFilePathSchema } from '@shared/types/file'
import { toFileUrl } from '@shared/utils/file'

/** Resolves a relative image source for display without changing its stored value. */
export function resolveImageSrc(src: string, baseDir?: string): string {
  try {
    if (!baseDir) return src
    const source = src.trim()
    if (!source || /^(?:[a-z][a-z0-9+.-]*:|[/\\])/i.test(source)) return source

    const suffixIndex = source.search(/[?#]/)
    const suffix = suffixIndex === -1 ? '' : source.slice(suffixIndex)
    const path = suffixIndex === -1 ? source : source.slice(0, suffixIndex)
    const windowsBase = /^[A-Za-z]:[\\/]/.test(baseDir) || /^[\\/]{2}/.test(baseDir)
    const encodedPath = (windowsBase ? path.replace(/\\/g, '/') : path)
      .split('/')
      .map((segment) => {
        segment = segment.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
          try {
            return decodeURIComponent(run)
          } catch {
            return run
          }
        })
        return encodeURIComponent(segment)
      })
      .join('/')
    const baseUrl = toFileUrl(AbsoluteFilePathSchema.parse(baseDir))
    return new URL(encodedPath, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).href + suffix
  } catch {
    return src
  }
}
