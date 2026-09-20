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
  reconcileRefetchedEndpointConfigs,
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

  it('keeps a reasoning format committed after the drawer snapshot when the draft is untouched', () => {
    const snapshot = { [PRIMARY]: { baseUrl: 'https://old' } } as any
    const live = {
      [PRIMARY]: { baseUrl: 'https://old', reasoningFormat: { type: 'self-hosted' } }
    } as any
    const out = mergeEndpointConfigs(live, { [PRIMARY]: { baseUrl: 'https://old' } }, snapshot)
    expect(out[PRIMARY]).toEqual({ baseUrl: 'https://old', reasoningFormat: { type: 'self-hosted' } })
  })

  it('honors a drawer-side reasoning format clear over the snapshot value', () => {
    const snapshot = {
      [PRIMARY]: { baseUrl: 'https://old', reasoningFormat: { type: 'self-hosted' } }
    } as any
    const out = mergeEndpointConfigs(snapshot, { [PRIMARY]: { baseUrl: 'https://old' } }, snapshot)
    expect(out[PRIMARY]).toEqual({ baseUrl: 'https://old' })
  })

  it('keeps a changed reasoning format committed after the snapshot when the draft still shows the snapshot option', () => {
    const snapshot = {
      [PRIMARY]: { baseUrl: 'https://old', reasoningFormat: { type: 'self-hosted' } }
    } as any
    const live = {
      [PRIMARY]: { baseUrl: 'https://old', reasoningFormat: { type: 'openai-chat' } }
    } as any
    const out = mergeEndpointConfigs(
      live,
      { [PRIMARY]: { baseUrl: 'https://old', reasoningFormat: { type: 'self-hosted' } } },
      snapshot
    )
    expect(out[PRIMARY]).toEqual({ baseUrl: 'https://old', reasoningFormat: { type: 'openai-chat' } })
  })

  it('keeps a reasoning format clear committed after the snapshot when the draft still shows the snapshot option', () => {
    const snapshot = {
      [PRIMARY]: { baseUrl: 'https://old', reasoningFormat: { type: 'self-hosted' } }
    } as any
    const live = { [PRIMARY]: { baseUrl: 'https://old' } } as any
    const out = mergeEndpointConfigs(
      live,
      { [PRIMARY]: { baseUrl: 'https://old', reasoningFormat: { type: 'self-hosted' } } },
      snapshot
    )
    expect(out[PRIMARY]).toEqual({ baseUrl: 'https://old' })
  })

  it('honors a drawer-side reasoning format set over a format committed after the snapshot', () => {
    const snapshot = { [PRIMARY]: { baseUrl: 'https://old' } } as any
    const live = {
      [PRIMARY]: { baseUrl: 'https://old', reasoningFormat: { type: 'openai-chat' } }
    } as any
    const out = mergeEndpointConfigs(
      live,
      { [PRIMARY]: { baseUrl: 'https://old', reasoningFormat: { type: 'self-hosted' } } },
      snapshot
    )
    expect(out[PRIMARY]).toEqual({ baseUrl: 'https://old', reasoningFormat: { type: 'self-hosted' } })
  })
})

describe('reconcileRefetchedEndpointConfigs', () => {
  const SELF_HOSTED = { type: 'self-hosted' } as any
  const snapshot = { [PRIMARY]: { baseUrl: 'https://old' } } as any

  it('prefers a shared format committed after the snapshot over a stale refetch', () => {
    const stale = { [PRIMARY]: { baseUrl: 'https://old' } } as any
    const shared = { [PRIMARY]: { baseUrl: 'https://old', reasoningFormat: SELF_HOSTED } } as any
    expect(reconcileRefetchedEndpointConfigs(stale, shared, snapshot)?.[PRIMARY]).toEqual({
      baseUrl: 'https://old',
      reasoningFormat: SELF_HOSTED
    })
  })

  it('prefers a refetch carrying an out-of-band format over an older shared snapshot', () => {
    const fresh = { [PRIMARY]: { baseUrl: 'https://old', reasoningFormat: SELF_HOSTED } } as any
    expect(reconcileRefetchedEndpointConfigs(fresh, snapshot, snapshot)?.[PRIMARY]).toEqual({
      baseUrl: 'https://old',
      reasoningFormat: SELF_HOSTED
    })
  })

  it('honors a coordinated clear over a stale refetch that still carries the format', () => {
    const clearedSnapshot = { [PRIMARY]: { baseUrl: 'https://old', reasoningFormat: SELF_HOSTED } } as any
    const stale = { [PRIMARY]: { baseUrl: 'https://old', reasoningFormat: SELF_HOSTED } } as any
    const cleared = { [PRIMARY]: { baseUrl: 'https://old' } } as any
    expect(reconcileRefetchedEndpointConfigs(stale, cleared, clearedSnapshot)?.[PRIMARY]).toEqual({
      baseUrl: 'https://old'
    })
  })

  it('returns the refetch untouched when nothing was committed after the snapshot', () => {
    const fresh = { [PRIMARY]: { baseUrl: 'https://new' } } as any
    expect(reconcileRefetchedEndpointConfigs(fresh, snapshot, snapshot)).toEqual(fresh)
  })

  it('falls back to the shared snapshot when the refetch is missing', () => {
    const shared = { [PRIMARY]: { baseUrl: 'https://old', reasoningFormat: SELF_HOSTED } } as any
    expect(reconcileRefetchedEndpointConfigs(undefined, shared, snapshot)).toBe(shared)
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

  it('excludes image endpoint types from the text endpoint list', () => {
    const types = resolveEndpointTypes(
      {
        endpointConfigs: {
          [PRIMARY]: {},
          'openai-image-generation': { baseUrl: 'https://images.example.com' },
          'openai-image-edit': { baseUrl: 'https://edits.example.com' }
        }
      },
      PRIMARY
    )

    expect(types).toEqual([PRIMARY])
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
