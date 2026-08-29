// @vitest-environment jsdom
import type { SidebarShortcutTarget } from '@shared/data/preference/preferenceTypes'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createSidebarShortcutTarget } from '../../../../utils/sidebar'
import { CORE_SIDEBAR_SHORTCUT_PROVIDERS } from '../providers'
import type { SidebarActivationGateway } from '../types'

const mocks = vi.hoisted(() => ({ preferenceGet: vi.fn() }))

vi.mock('@renderer/data/DataApiService', () => ({
  dataApiService: { get: vi.fn(), onDataChanged: vi.fn() }
}))
vi.mock('@renderer/data/PreferenceService', () => ({
  preferenceService: { get: mocks.preferenceGet }
}))
vi.mock('@renderer/i18n/resolver', () => ({
  default: { t: (key: string) => key, on: vi.fn(), off: vi.fn() }
}))

function provider(id: string) {
  const result = CORE_SIDEBAR_SHORTCUT_PROVIDERS.find((candidate) => candidate.id === id)
  if (!result) throw new Error(`Missing provider ${id}`)
  return result
}

describe('core sidebar shortcut providers', () => {
  const openWorkspace = vi.fn()
  const openSettings = vi.fn()
  const gateway: SidebarActivationGateway = { openWorkspace, openSettings }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.preferenceGet.mockResolvedValue('openai')
  })

  it.each([
    ['core.app', 'files', 'workspace', '/app/files'],
    ['core.mini-app', 'mini app/one', 'workspace', '/app/mini-app/mini%20app%2Fone'],
    ['core.agent', 'agent/one', 'workspace', '/app/agents?agentId=agent%2Fone'],
    ['core.assistant', 'assistant/one', 'workspace', '/app/chat?assistantId=assistant%2Fone'],
    ['core.skill', 'skill/one', 'settings', '/settings/skills?id=skill%2Fone'],
    ['core.mcp-server', 'server/one', 'settings', '/settings/mcp/settings/server%2Fone'],
    ['core.provider', 'provider/one', 'settings', '/settings/provider?id=provider%2Fone']
  ])('reveals %s resources through the activation gateway', async (providerId, resourceId, kind, expectedUrl) => {
    const target = createSidebarShortcutTarget(providerId, resourceId)

    await provider(providerId).activate(target, gateway)

    if (kind === 'workspace') expect(openWorkspace).toHaveBeenCalledWith(expect.objectContaining({ url: expectedUrl }))
    else expect(openSettings).toHaveBeenCalledWith(expectedUrl)
  })

  it.each(CORE_SIDEBAR_SHORTCUT_PROVIDERS)('rejects unknown activations for $id', (shortcutProvider) => {
    const target: SidebarShortcutTarget = createSidebarShortcutTarget(shortcutProvider.id, 'resource', 'run')

    expect(shortcutProvider.validate(target)).toBe(false)
  })
})
