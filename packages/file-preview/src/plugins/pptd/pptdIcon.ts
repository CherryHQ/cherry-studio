/**
 * Font Awesome free icon resolution for PPTD icon elements. SVGs come from
 * the pinned jsdelivr CDN path for the @fortawesome/fontawesome-free package
 * and are cached per icon for the session; offline or unknown icons resolve
 * to null so the caller can show its placeholder.
 */

const STYLE_DIRECTORY: Record<string, string> = {
  fas: 'solid',
  far: 'regular',
  fab: 'brands'
}

const FA_VERSION = '7.0.1'

export interface PptdIconData {
  viewBox: string
  innerHtml: string
}

/** Parses "style:name" into a CDN-safe pair, or null for anything exotic. */
export function parsePptdIconName(iconName: string): { style: string; name: string } | null {
  const [style, name] = iconName.split(':')
  if (!style || !name || !(style in STYLE_DIRECTORY)) return null
  if (!/^[a-z0-9-]+$/.test(name)) return null
  return { style, name }
}

export function pptdIconUrl(style: string, name: string): string {
  const directory = STYLE_DIRECTORY[style]
  return `https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@${FA_VERSION}/svgs/${directory}/${name}.svg`
}

const cache = new Map<string, Promise<PptdIconData | null>>()

export function fetchPptdIcon(iconName: string, signal?: AbortSignal): Promise<PptdIconData | null> {
  const parsed = parsePptdIconName(iconName)
  if (!parsed) return Promise.resolve(null)
  const key = `${parsed.style}:${parsed.name}`
  let pending = cache.get(key)
  if (!pending) {
    pending = fetch(pptdIconUrl(parsed.style, parsed.name), { signal })
      .then((response) => (response.ok ? response.text() : null))
      .then((text) => {
        if (!text) return null
        const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
        const svg = doc.querySelector('svg')
        if (!svg || doc.querySelector('parsererror')) return null
        return { viewBox: svg.getAttribute('viewBox') ?? '0 0 512 512', innerHtml: svg.innerHTML }
      })
      .catch(() => null)
    cache.set(key, pending)
  }
  return pending
}
