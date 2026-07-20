const TOKEN_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:~-]*$/
const SEMANTIC_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/

export type UiTokenValue = string | false | null | undefined

export interface UiTokenOptions {
  exactId?: string
  parts?: readonly UiTokenValue[]
  scopes?: readonly UiTokenValue[]
}

export interface ParsedUiTokens {
  exactId?: string
  parts: string[]
  scopes: string[]
  semanticId?: string
}

function assertSemanticId(value: string): void {
  if (!SEMANTIC_ID.test(value)) {
    throw new Error(`Invalid data-ui semantic ID: ${value}`)
  }
}

function assertTokenValue(value: string, namespace: string): void {
  if (!TOKEN_VALUE.test(value)) {
    throw new Error(`Invalid data-ui ${namespace} token value: ${value}`)
  }
}

function namespaced(namespace: string, values: readonly UiTokenValue[] | undefined): string[] {
  const result: string[] = []
  for (const value of values ?? []) {
    if (!value) continue
    assertTokenValue(value, namespace)
    result.push(`${namespace}:${value}`)
  }
  return result
}

export function uiTokens(semanticId: string, options: UiTokenOptions = {}): string {
  assertSemanticId(semanticId)
  if (options.exactId) assertTokenValue(options.exactId, 'id')

  return [
    semanticId,
    ...namespaced('part', options.parts),
    options.exactId ? `id:${options.exactId}` : undefined,
    ...namespaced('scope', options.scopes)
  ]
    .filter((token): token is string => Boolean(token))
    .filter((token, index, tokens) => tokens.indexOf(token) === index)
    .join(' ')
}

export function parseUiTokens(value: string | null | undefined): ParsedUiTokens {
  const result: ParsedUiTokens = {
    parts: [],
    scopes: []
  }
  for (const token of value?.split(/\s+/).filter(Boolean) ?? []) {
    const separator = token.indexOf(':')
    if (separator === -1) {
      result.semanticId ??= token
      continue
    }
    const namespace = token.slice(0, separator)
    const tokenValue = token.slice(separator + 1)
    if (namespace === 'id') result.exactId ??= tokenValue
    else if (namespace === 'part') result.parts.push(tokenValue)
    else if (namespace === 'scope') result.scopes.push(tokenValue)
  }
  return result
}

function selectorToken(token: string): string {
  if (!/^[A-Za-z0-9._:~-]+$/.test(token)) throw new Error(`Invalid data-ui selector token: ${token}`)
  return `[data-ui~="${token}"]`
}

export interface UiSelectorOptions extends UiTokenOptions {
  semanticId?: string
}

export function uiSelector(options: UiSelectorOptions): string {
  const tokens = [
    options.semanticId,
    ...namespaced('part', options.parts),
    options.exactId ? `id:${options.exactId}` : undefined,
    ...namespaced('scope', options.scopes)
  ].filter((token): token is string => Boolean(token))
  if (tokens.length === 0) throw new Error('A data-ui selector requires at least one token')
  if (options.semanticId) assertSemanticId(options.semanticId)
  return tokens.map(selectorToken).join('')
}
