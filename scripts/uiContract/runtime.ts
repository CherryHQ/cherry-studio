function tokens(value: unknown): string[] {
  return typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : []
}

function findLast(tokens: string[], predicate: (token: string) => boolean): string | undefined {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    if (predicate(tokens[index])) return tokens[index]
  }
  return undefined
}

/**
 * Compose the caller-owned semantic/state tokens with the implementation-owned
 * part and exact-ID tokens. The implementation exact ID wins because it names
 * the real intrinsic DOM node; the most specific caller semantic wins.
 */
export function mergeDataUi(contract: string, ...forwardedValues: unknown[]): string {
  const contractTokens = tokens(contract)
  const forwardedTokens = forwardedValues.flatMap(tokens)
  const semantic =
    findLast(forwardedTokens, (token) => !token.includes(':')) ?? contractTokens.find((token) => !token.includes(':'))
  const exactId =
    contractTokens.find((token) => token.startsWith('id:')) ??
    findLast(forwardedTokens, (token) => token.startsWith('id:'))
  const namespaced = [...contractTokens, ...forwardedTokens].filter(
    (token) => token.includes(':') && !token.startsWith('id:')
  )
  const parts = namespaced.filter((token) => token.startsWith('part:'))
  const remaining = namespaced.filter((token) => !token.startsWith('part:'))

  return [
    ...new Set([semantic, ...parts, exactId, ...remaining].filter((token): token is string => Boolean(token)))
  ].join(' ')
}

/** Preserve normal JSX spread behavior while composing a spread-owned data-ui value. */
export function mergeUiProps<T>(props: T, contract: string): T {
  if ((typeof props !== 'object' && typeof props !== 'function') || props === null) return props
  if (!Object.prototype.hasOwnProperty.call(props, 'data-ui')) return props

  return {
    ...props,
    'data-ui': mergeDataUi(contract, (props as Record<string, unknown>)['data-ui'])
  } as T
}
