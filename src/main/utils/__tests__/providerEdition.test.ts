import type { Provider } from '@shared/data/types/provider'
import type { AppEdition } from '@shared/types/appEdition'
import { describe, expect, it } from 'vitest'

import { isProviderAvailableInEdition } from '../providerEdition'

const provider = (supportedEditions?: AppEdition[]): Provider => ({ supportedEditions }) as Provider

describe('isProviderAvailableInEdition', () => {
  it.each<[string, AppEdition[] | undefined, AppEdition, boolean]>([
    ['supports the CN edition', ['global', 'cn'], 'cn', true],
    ['excludes a global-only preset from the CN edition', ['global'], 'cn', false],
    ['excludes a CN-only preset from the global edition', ['cn'], 'global', false],
    ['keeps a custom provider edition-neutral', undefined, 'cn', true]
  ])('%s', (_label, supportedEditions, edition, expected) => {
    expect(isProviderAvailableInEdition(provider(supportedEditions), edition)).toBe(expected)
  })
})
