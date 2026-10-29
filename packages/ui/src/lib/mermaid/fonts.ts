/** A serializable `@font-face` rule, so another realm (a Web Worker) can load the page's web fonts. */
export interface FontFaceSource {
  family: string
  source: string
  descriptors: FontFaceDescriptors
}

const unquote = (family: string) => family.trim().replace(/^["']|["']$/g, '')

/**
 * Collects the page's `@font-face` rules for the families in a CSS `font-family` list, with absolute URLs.
 * System fonts have no rule and need none: every realm can already use them.
 */
export function collectFontFaces(fontFamily: string): FontFaceSource[] {
  const families = new Set(fontFamily.split(',').map(unquote))
  const faces: FontFaceSource[] = []
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue // Cross-origin sheets are unreadable; the app ships its fonts locally.
    }
    const base = sheet.href ?? document.baseURI
    for (const rule of rules) {
      if (!(rule instanceof CSSFontFaceRule)) continue
      const family = unquote(rule.style.getPropertyValue('font-family'))
      if (!families.has(family)) continue
      const source = rule.style
        .getPropertyValue('src')
        .replace(
          /url\((["']?)([^"')]+)\1\)/g,
          (_, quote: string, url: string) => `url(${quote}${new URL(url, base).href}${quote})`
        )
      faces.push({
        family,
        source,
        descriptors: {
          style: rule.style.getPropertyValue('font-style') || 'normal',
          weight: rule.style.getPropertyValue('font-weight') || 'normal',
          unicodeRange: rule.style.getPropertyValue('unicode-range') || 'U+0-10FFFF'
        }
      })
    }
  }
  return faces
}

const registered = new Map<string, Promise<unknown>>()

/** Registers `faces` in `fontSet` once each and waits until they have loaded, so canvas measurement uses them. */
export async function ensureFontFaces(faces: readonly FontFaceSource[], fontSet: FontFaceSet): Promise<void> {
  await Promise.all(
    faces.map((face) => {
      const key = `${face.family}|${face.source}|${face.descriptors.weight}|${face.descriptors.style}`
      let loading = registered.get(key)
      if (!loading) {
        const fontFace = new FontFace(face.family, face.source, face.descriptors)
        fontSet.add(fontFace)
        loading = fontFace.load().catch(() => undefined) // A missing face falls back like it would on the page.
        registered.set(key, loading)
      }
      return loading
    })
  )
}
