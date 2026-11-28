const colorProperties = new Set([
  'color',
  'background-color',
  'border-color',
  'outline-color',
  '--background',
  '--background-subtle',
  '--foreground',
  '--foreground-tertiary',
  '--foreground-disabled',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--destructive',
  '--destructive-foreground',
  '--border',
  '--border-subtle',
  '--border-strong',
  '--input',
  '--ring',
  '--sidebar',
  '--sidebar-foreground',
  '--sidebar-primary',
  '--sidebar-primary-foreground',
  '--sidebar-accent',
  '--sidebar-accent-foreground',
  '--sidebar-border',
  '--sidebar-ring'
])
const themeScopes = new Set([
  ':root',
  'html',
  'body',
  '.light',
  '.dark',
  ':root.light',
  ':root.dark',
  ':root:not(.dark)',
  'html.light',
  'html.dark',
  'body.light',
  'body.dark',
  'body[theme-mode="light"]',
  'body[theme-mode="dark"]'
])
const literalColor =
  /^(?:#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|(?:rgba?|hsla?|oklch|oklab)\([\d\s.,%/+-]+\)|transparent|black|white|red|green|blue)$/i

/** Build a new stylesheet from literal colors. The catalog stylesheet is never attached to a document. */
export function extractMarketplaceThemeColors(source: string): string {
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(source)
  const rules: string[] = []
  for (const rule of Array.from(sheet.cssRules)) {
    if (!(rule instanceof CSSStyleRule)) continue
    const scopes = rule.selectorText.split(',').map((selector) => selector.trim())
    if (!scopes.every((selector) => themeScopes.has(selector))) continue
    const colors: string[] = []
    for (const property of Array.from(rule.style)) {
      const target = property === 'background' ? 'background-color' : property
      if (!colorProperties.has(target)) continue
      const value = rule.style.getPropertyValue(property).trim()
      if (!literalColor.test(value)) continue
      const priority = rule.style.getPropertyPriority(property) === 'important' ? ' !important' : ''
      colors.push(`${target}: ${value}${priority};`)
    }
    if (colors.length) rules.push(`${scopes.join(', ')} { ${colors.join(' ')} }`)
  }
  return rules.join('\n')
}
