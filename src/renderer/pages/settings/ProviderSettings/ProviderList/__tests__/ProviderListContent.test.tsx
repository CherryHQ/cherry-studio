import type { Provider } from '@shared/data/types/provider'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// Capture every <ReorderableList> mount's `items` prop so we can assert the
// grouped path feeds the full cache (C1 regression).
const reorderableItemsCalls: Provider[][] = []

vi.mock('@cherrystudio/ui', () => ({
  ...(() => {
    const R = require('react')
    const s =
      (omit: string[] = []) =>
      ({ children, ...p }: any) => {
        for (const k of ['direction', 'align', 'justify', 'gap', 'wrap', 'inline', 'asChild', ...omit]) delete p[k]
        return R.createElement('div', p, children)
      }
    return {
      Box: s(),
      Flex: s(),
      HStack: s(),
      VStack: s(),
      Stack: s(),
      Center: s(),
      Grid: s(['columns', 'flow']),
      PageShell: s(['scroll']),
      Container: s(['size', 'padded', 'fluid']),
      Spacer: s(),
      TruncatingRow: ({ children, leading, trailing, ...p }: any) => {
        for (const k of ['gap', 'align', 'justify', 'wrap', 'asChild']) delete p[k]
        return R.createElement('div', p, leading, children, trailing)
      }
    }
  })(),
  ReorderableList: ({ items }: { items: Provider[] }) => {
    reorderableItemsCalls.push(items)
    return null
  }
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/i18n/label', () => ({ getProviderLabel: (id: string) => id }))
vi.mock('@renderer/pages/settings/ProviderSettings/components/ProviderAvatar', () => ({
  ProviderAvatar: () => null
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} }
}))
vi.mock('@renderer/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }))
vi.mock('@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives', () => ({
  providerListClasses: new Proxy({}, { get: () => '' })
}))

import ProviderListContent from '../ProviderListContent'

function provider(id: string, presetProviderId: string, isEnabled = true): Provider {
  return {
    id,
    name: id,
    presetProviderId,
    apiKeys: [],
    authType: 'api-key',
    apiFeatures: {},
    settings: {},
    isEnabled
  } as unknown as Provider
}

describe('ProviderListContent — C1 grouped reorder', () => {
  it('passes the full unfiltered cache as ReorderableList items in a group', () => {
    reorderableItemsCalls.length = 0

    // Full cache: 3 providers under the same preset; one disabled and filtered out.
    const all = [
      provider('zhipu-a', 'zhipu', true),
      provider('zhipu-b', 'zhipu', true),
      provider('zhipu-c', 'zhipu', false)
    ]
    const visible = all.filter((p) => p.isEnabled) // default `enabled` filter view

    render(
      <ProviderListContent
        providers={all}
        visibleProviders={visible}
        searchActive={false}
        expandedGroups={{ zhipu: true }}
        onToggleGroup={() => {}}
        onDragStateChange={() => {}}
        onReorder={() => {}}
        renderItem={() => null}
      />
    )

    // The group's ReorderableList must receive the full 3-item cache, not the
    // 2-item filtered view — otherwise computeMinimalMoves throws on reorder.
    expect(reorderableItemsCalls.length).toBeGreaterThan(0)
    expect(reorderableItemsCalls.every((items) => items.length === all.length)).toBe(true)
  })
})
