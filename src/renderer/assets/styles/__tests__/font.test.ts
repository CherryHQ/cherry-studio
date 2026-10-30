import { readFileSync } from 'node:fs'

import postcss, { type Declaration } from 'postcss'
import { describe, expect, it } from 'vitest'

const fontStyles = readFileSync('src/renderer/assets/styles/font.css', 'utf8')

describe('serif font styles', () => {
  it('requests the configured global font before the generic serif fallback', () => {
    const declarations: Declaration[] = []

    postcss.parse(fontStyles).walkDecls('--font-family-serif', (declaration) => {
      declarations.push(declaration)
    })

    expect(declarations.some(({ parent }) => parent?.type === 'rule' && parent.selectors.includes(':root'))).toBe(true)

    // Configured global font wins over the serif switch; generic serif stays as the fallback.
    for (const declaration of declarations) {
      const families = postcss.list.comma(declaration.value)
      expect(families[0]).toMatch(/^var\(\s*--app-user-font-family\s*,\s*serif\s*\)$/)
      expect(families[1]).toBe('serif')
    }
  })
})
