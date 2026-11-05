import { readFileSync } from 'node:fs'

import postcss, { type Declaration, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'

const appStyles = readFileSync('src/renderer/assets/styles/index.css', 'utf8')

function findCustomBackgroundRule(selector: string): Rule | undefined {
  let match: Rule | undefined
  postcss.parse(appStyles).walkRules((rule) => {
    if (rule.selectors.includes(selector)) {
      match = rule
    }
  })
  return match
}

function declarationsOf(rule: Rule | undefined): string[] {
  return rule?.nodes.filter((node): node is Declaration => node.type === 'decl').map((declaration) => declaration.prop) ?? []
}

const ROOT_RULE = ':root[data-custom-background]'
const BODY_DARK_RULE = ':root[data-custom-background] body.dark'

describe('custom background surface treatment', () => {
  // ThemeProvider puts `.dark` on both <html> and <body>. The token contract
  // redeclares `--composer-surface` / `--chat-message-well` at body scope, where
  // a :root-only treatment loses in dark mode (opaque composer) — so those two
  // tokens get a body-scoped rule. `--background` / `--sidebar` / `--card` have
  // no body-scoped declaration to beat; the root rule resolves `var(--cs-*)`
  // against the dark providers the root element carries in dark mode.
  it('scopes every translucent surface token to :root', () => {
    expect(declarationsOf(findCustomBackgroundRule(ROOT_RULE))).toEqual(
      expect.arrayContaining(['--background', '--sidebar', '--card', '--chat-message-well', '--composer-surface'])
    )
  })

  it('reaches body.dark for the tokens the token contract redeclares there', () => {
    expect(declarationsOf(findCustomBackgroundRule(BODY_DARK_RULE))).toEqual(
      expect.arrayContaining(['--chat-message-well', '--composer-surface'])
    )
  })

  it('keeps root-inherited tokens off body.dark so unlayered user custom CSS keeps winning', () => {
    // A body-scoped declaration beats ANY value body would inherit from :root,
    // regardless of layer order — so declaring `--background` / `--sidebar` /
    // `--card` here would silently replace user customizations like
    // `:root { --background: green; --card: blue; }` in dark mode.
    const declarations = declarationsOf(findCustomBackgroundRule(BODY_DARK_RULE))
    expect(declarations).not.toContain('--background')
    expect(declarations).not.toContain('--sidebar')
    expect(declarations).not.toContain('--card')
  })

  it('stays in the app layer so unlayered user custom CSS keeps winning', () => {
    for (const rule of [findCustomBackgroundRule(ROOT_RULE), findCustomBackgroundRule(BODY_DARK_RULE)]) {
      expect(rule?.parent?.type).toBe('atrule')
      expect(rule?.parent).toMatchObject({ name: 'layer', params: 'app' })
    }
  })
})
