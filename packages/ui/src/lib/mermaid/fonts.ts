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
  // Production bundles wrap rules in `@layer`, so walk grouping rules and imported sheets, not just the top level.
  const collect = (sheet: CSSStyleSheet, rules: CSSRuleList) => {
    for (const rule of rules) {
      if (rule instanceof CSSImportRule && rule.styleSheet) visit(rule.styleSheet)
      else if (rule instanceof CSSGroupingRule) collect(sheet, rule.cssRules)
      else if (rule instanceof CSSFontFaceRule) {
        const family = unquote(rule.style.getPropertyValue('font-family'))
        if (families.has(family)) faces.push(toSource(rule, family, sheet.href ?? document.baseURI))
      }
    }
  }
  const visit = (sheet: CSSStyleSheet) => {
    try {
      collect(sheet, sheet.cssRules)
    } catch {
      // Cross-origin sheets are unreadable; the app ships its fonts locally.
    }
  }
  for (const sheet of document.styleSheets) visit(sheet)
  return faces
}

function toSource(rule: CSSFontFaceRule, family: string, base: string): FontFaceSource {
  const source = rule.style
    .getPropertyValue('src')
    .replace(
      /url\((["']?)([^"')]+)\1\)/g,
      (_, quote: string, url: string) => `url(${quote}${new URL(url, base).href}${quote})`
    )
  return {
    family,
    source,
    descriptors: {
      style: rule.style.getPropertyValue('font-style') || 'normal',
      weight: rule.style.getPropertyValue('font-weight') || 'normal',
      unicodeRange: rule.style.getPropertyValue('unicode-range') || 'U+0-10FFFF'
    }
  }
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
