export const CUSTOM_THEME_SCOPE_SELECTOR = '[data-ui~="boundary:app"][data-ui~="theme:custom"]'

const RAW_DIRECTIVE = /\/\*\s*@cherry-ui\s+raw\s*\*\//i
const SCOPED_DIRECTIVE = /\/\*\s*@cherry-ui\s+scoped\s*\*\//i
const UNSCOPABLE_AT_RULE = /^\s*(?:\/\*[\s\S]*?\*\/\s*)*@(charset|import|namespace)\b/i

export interface CompiledUiThemeCss {
  css: string
  mode: 'raw' | 'scoped'
  warnings: string[]
}

/**
 * Isolate custom CSS to the current Cherry Studio window by default. `@import` and
 * `@charset` cannot safely live inside an `@scope`; authors who intentionally need
 * global CSS can opt out with `/* @cherry-ui raw *\/`.
 */
export function compileUiThemeCss(source: string): CompiledUiThemeCss {
  const raw = RAW_DIRECTIVE.test(source)
  const css = source.replace(RAW_DIRECTIVE, '').replace(SCOPED_DIRECTIVE, '').trim()

  if (raw) return { css, mode: 'raw', warnings: [] }

  const unsupported = css.match(UNSCOPABLE_AT_RULE)?.[1]
  const warnings = unsupported
    ? [`@${unsupported} is not supported in isolated custom CSS; use /* @cherry-ui raw */ to opt out.`]
    : []
  if (!css || unsupported) return { css: '', mode: 'scoped', warnings }

  return {
    css: `@scope (${CUSTOM_THEME_SCOPE_SELECTOR}) {\n${css}\n}`,
    mode: 'scoped',
    warnings
  }
}
