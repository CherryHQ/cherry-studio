// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { codeBlockToHtml, getCodeBlockPalette } from '../../../code-block'
import { cherryCodeTheme } from '../../../code-highlight'

const stylesDir = join(import.meta.dirname, '../../../styles')
const css = readdirSync(stylesDir, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.css'))
  .map((file) => readFileSync(join(stylesDir, file), 'utf8'))
  .join('\n')

function declarations(selector: string) {
  const values: Record<string, string> = {}
  for (const [, body] of css.matchAll(new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')} \\{([^}]*)\\}`, 'g'))) {
    for (const [, name, value] of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) values[name] = value.trim()
  }
  return values
}
const light = declarations(':root')
const dark = { ...light, ...declarations('.dark') }

function resolve(name: string, scope: Record<string, string>): string {
  const value = scope[name]
  const reference = value?.match(/^var\((--[\w-]+)\)$/)
  return reference ? resolve(reference[1], scope) : value
}

type Rgb = [number, number, number]
function oklchToLinear(value: string): Rgb {
  const [L, C, h] = value
    .match(/oklch\(([^)/]+)/)![1]
    .trim()
    .split(/\s+/)
    .map(Number)
  const a = C * Math.cos((h * Math.PI) / 180)
  const b = C * Math.sin((h * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ].map((v) => Math.min(1, Math.max(0, v))) as Rgb
}
const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b
function contrast(a: Rgb, b: Rgb) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
// Dark --cs-background is 55% opaque; composite it over a light-ish vibrancy material as the worst case.
const darkHost = oklchToLinear(resolve('--cs-background', dark)).map(
  (v, i) => v * 0.55 + oklchToLinear('oklch(0.3 0 0)')[i] * 0.45
) as Rgb
const roles = [
  'foreground',
  'muted',
  'keyword',
  'string',
  'constant',
  'type',
  'function',
  'tag',
  'link',
  'inserted',
  'deleted'
]

describe('Cherry default code theme', () => {
  it.each(roles)('keeps %s readable (WCAG AA) on light and dark hosts', (role) => {
    const name = `--cherry-code-${role}`
    expect(contrast(oklchToLinear(resolve(name, light)), [1, 1, 1])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(oklchToLinear(resolve(name, dark)), darkHost)).toBeGreaterThanOrEqual(4.5)
  })

  it('exports the same light colors the app CSS renders', () => {
    const defaults = typeof cherryCodeTheme.cssVariables === 'object' ? cherryCodeTheme.cssVariables.defaults : {}
    for (const role of roles) expect(defaults?.[role], role).toBe(resolve(`--cherry-code-${role}`, light))
  })

  it('maps palette suffixes to CSS variables instead of emitting them as colors', () => {
    const palette = getCodeBlockPalette(cherryCodeTheme)
    expect(palette['--code-background']).toBe('var(--cherry-code-background, transparent)')
    for (const [name, value] of Object.entries(palette)) {
      if (!name.endsWith('-style') && !name.endsWith('-weight')) expect(value, name).toMatch(/^var\(--cherry-code-/)
    }
  })

  it('keeps syntax colors in exported HTML without application CSS', async () => {
    const node = document.createElement('div')
    node.innerHTML = await codeBlockToHtml('const answer = "42"\n', 'ts', 'cherry')
    const keyword = Array.from(node.querySelectorAll('span')).find((span) => span.textContent === 'const')
    expect(keyword?.getAttribute('style')).toContain(
      `var(--cherry-code-keyword, ${resolve('--cherry-code-keyword', light)})`
    )
  })
})
