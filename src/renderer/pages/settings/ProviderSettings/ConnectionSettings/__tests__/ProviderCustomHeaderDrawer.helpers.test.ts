import { describe, expect, it, vi } from 'vitest'

// The SUT module pulls UI/hook/IPC deps at import time; stub them so the
// pure helpers can be unit-tested without render machinery.
vi.mock('@cherrystudio/ui', () => ({}))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ error: vi.fn() }) } }))
vi.mock('@renderer/hooks/useProvider', () => ({ useProvider: () => ({}) }))
vi.mock('@renderer/utils/style', () => ({
  cn: (...a: any[]) => a.filter(Boolean).join(' ')
}))

vi.mock('@renderer/utils/api', () => ({
  // Delegation boundary: a simple http(s) shape is enough — validateApiHost
  // has its own tests; here we only pin the skip/iterate logic.
  validateApiHost: (h: string) => /^https?:\/\/[^\s]+$/.test(h)
}))
vi.mock('../../hooks/useProviderModelSync', () => ({ useProviderModelSync: () => ({}) }))
vi.mock('../../primitives/ProviderActions', () => ({ default: () => null }))
vi.mock('../../primitives/ProviderSettingsDrawer', () => ({ default: () => null }))
vi.mock('../../primitives/ProviderSettingsPrimitives', () => ({
  customHeaderDrawerClasses: {},
  drawerClasses: {},
  fieldClasses: {}
}))
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (k: string) => k })
}))

import {
  findInvalidSecondaryEndpointUrl,
  mergeEndpointConfigs,
  resolveEndpointTypes
} from '../ProviderCustomHeaderDrawer'

const PRIMARY = 'openai-chat-completions' as any
const SECONDARY = 'anthropic-messages' as any

describe('mergeEndpointConfigs', () => {
  it('writes a non-primary baseUrl from a non-empty draft', () => {
    const out = mergeEndpointConfigs({}, { [SECONDARY]: { baseUrl: 'https://anthropic.example.com' } })
    expect(out[SECONDARY]).toEqual({ baseUrl: 'https://anthropic.example.com' })
  })

  it('drops a non-primary entry entirely when its draft is cleared', () => {
    const out = mergeEndpointConfigs({ [SECONDARY]: { baseUrl: 'https://old' } }, { [SECONDARY]: { baseUrl: '' } })
    expect(SECONDARY in out).toBe(false)
  })

  it('removes the primary entry when cleared and no other fields remain', () => {
    const out = mergeEndpointConfigs({ [PRIMARY]: { baseUrl: 'https://old' } }, { [PRIMARY]: { baseUrl: '' } })
    expect(PRIMARY in out).toBe(false)
  })

  it('preserves unrelated configured fields on a drafted endpoint', () => {
    const out = mergeEndpointConfigs(
      { [PRIMARY]: { baseUrl: 'https://old', modelsApiUrls: ['https://models'] } as any },
      { [PRIMARY]: { baseUrl: 'https://new' } }
    )
    expect(out[PRIMARY]).toEqual({ baseUrl: 'https://new', modelsApiUrls: ['https://models'] })
  })
})

describe('resolveEndpointTypes', () => {
  it('puts primary first, then configured others sorted', () => {
    const types = resolveEndpointTypes(
      { endpointConfigs: { 'gemini-generate-content': {}, [SECONDARY]: {}, [PRIMARY]: {} } as any },
      PRIMARY
    )
    expect(types[0]).toBe(PRIMARY)
    expect(types.slice(1)).toEqual(['anthropic-messages', 'gemini-generate-content'])
  })
})

describe('findInvalidSecondaryEndpointUrl', () => {
  it('returns the offending type for a non-empty invalid secondary url', () => {
    expect(findInvalidSecondaryEndpointUrl({ [SECONDARY]: { baseUrl: 'garbage://x' } }, PRIMARY)).toBe(SECONDARY)
  })

  it('ignores the primary slot and empty/valid secondaries', () => {
    expect(
      findInvalidSecondaryEndpointUrl(
        {
          [PRIMARY]: { baseUrl: 'garbage://primary' },
          [SECONDARY]: { baseUrl: '   ' },
          'gemini-generate-content': { baseUrl: 'https://ok.example.com' }
        },
        PRIMARY
      )
    ).toBeNull()
  })
})
