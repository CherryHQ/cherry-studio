import { describe, expect, it } from 'vitest'

import { compileUiThemeCss, CUSTOM_THEME_SCOPE_SELECTOR } from '../themeCss'

describe('UI theme CSS compiler', () => {
  it('isolates custom CSS to the app theme boundary by default', () => {
    const result = compileUiThemeCss('[data-ui~="chat.message"] { display: grid; }')

    expect(result.mode).toBe('scoped')
    expect(result.css).toContain(`@scope (${CUSTOM_THEME_SCOPE_SELECTOR})`)
  })

  it('supports an explicit raw escape hatch', () => {
    const result = compileUiThemeCss('/* @cherry-ui raw */\nbody { color: red; }')

    expect(result).toEqual({ css: 'body { color: red; }', mode: 'raw', warnings: [] })
  })

  it('does not silently leak imported CSS outside the app boundary', () => {
    const result = compileUiThemeCss('@import url("theme.css");')

    expect(result.css).toBe('')
    expect(result.warnings).toHaveLength(1)
  })
})
