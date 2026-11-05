import { readFileSync } from 'node:fs'

import postcss, { type Declaration, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'

const appStyles = readFileSync('src/renderer/assets/styles/index.css', 'utf8')

function findCustomBackgroundRule(): Rule | undefined {
  let match: Rule | undefined
  postcss.parse(appStyles).walkRules((rule) => {
    if (rule.selectors.includes(':root[data-custom-background]')) {
      match = rule
    }
  })
  return match
}

describe('custom background surface treatment', () => {
  // ThemeProvider puts `.dark` on <body>, and the token contract redeclares
  // `--composer-surface` / `--chat-message-well` / the dark `--cs-*` providers at
  // that body scope. A :root-only rule loses to those declarations in dark mode
  // (opaque composer) and resolves `var(--cs-*)` against the root element's light
  // providers, so the translucent treatment must reach body scope too.
  it('scopes the translucent tokens to body.dark as well as :root', () => {
    expect(findCustomBackgroundRule()?.selectors).toContain(':root[data-custom-background] body.dark')
  })

  it('keeps every translucent surface token on the same rule', () => {
    const declarations =
      findCustomBackgroundRule()
        ?.nodes.filter((node): node is Declaration => node.type === 'decl')
        .map((declaration) => declaration.prop) ?? []
    expect(declarations).toEqual(
      expect.arrayContaining(['--background', '--sidebar', '--card', '--chat-message-well', '--composer-surface'])
    )
  })

  it('stays in the app layer so unlayered user custom CSS keeps winning', () => {
    const rule = findCustomBackgroundRule()
    expect(rule?.parent?.type).toBe('atrule')
    expect(rule?.parent).toMatchObject({ name: 'layer', params: 'app' })
  })
})
