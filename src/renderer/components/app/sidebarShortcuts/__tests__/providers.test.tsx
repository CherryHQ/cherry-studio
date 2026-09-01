// @vitest-environment jsdom
import type { SidebarShortcutTarget } from '@shared/data/preference/preferenceTypes'
import { CodeCli } from '@shared/types/codeCli'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createSidebarShortcutTarget } from '../../../../utils/sidebar'
import { CORE_SIDEBAR_SHORTCUT_PROVIDERS } from '../providers'
import type { SidebarActivationGateway } from '../types'

const mocks = vi.hoisted(() => ({ dataGet: vi.fn(), preferenceGet: vi.fn() }))

vi.mock('@renderer/data/DataApiService', () => ({
  dataApiService: { get: mocks.dataGet, onDataChanged: vi.fn() }
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
    ['core.knowledge-base', 'base/one', 'workspace', '/app/knowledge?baseId=base%2Fone'],
    ['core.topic', 'topic/one', 'workspace', '/app/chat?topicId=topic%2Fone'],
    ['core.agent-session', 'session/one', 'workspace', '/app/agents?sessionId=session%2Fone'],
    ['core.code-cli', CodeCli.OPENAI_CODEX, 'workspace', '/app/code?tool=openai-codex'],
    [
      'core.file-entry',
      '018f47d2-e657-7b4c-a7c1-8b52cbb9d114',
      'workspace',
      '/app/files?entryId=018f47d2-e657-7b4c-a7c1-8b52cbb9d114'
    ]
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

  it.each(['core.skill', 'core.mcp-server', 'core.provider'])('does not register %s', (providerId) => {
    expect(CORE_SIDEBAR_SHORTCUT_PROVIDERS.some((candidate) => candidate.id === providerId)).toBe(false)
  })

  it('accepts known Code Mate CLIs and rejects unknown resource ids', () => {
    const shortcutProvider = provider('core.code-cli')

    expect(shortcutProvider.validate(createSidebarShortcutTarget('core.code-cli', CodeCli.CLAUDE_CODE))).toBe(true)
    expect(shortcutProvider.validate(createSidebarShortcutTarget('core.code-cli', 'unknown-cli'))).toBe(false)
  })

  it('resolves Code Mate CLIs from the static presentation catalog', async () => {
    const targets = [
      createSidebarShortcutTarget('core.code-cli', CodeCli.OPENAI_CODEX),
      createSidebarShortcutTarget('core.code-cli', CodeCli.CLAUDE_CODE)
    ]

    const result = await provider('core.code-cli').resolveMany(targets)

    expect([...result.values()].map((item) => item.label)).toEqual([
      'code.cli_tools.claude_code',
      'code.cli_tools.openai_codex'
    ])
    expect([...result.values()].every((item) => item.supportsNewTab)).toBe(true)
    expect(mocks.dataGet).not.toHaveBeenCalled()
  })

  it('uses a LayoutGrid glyph when a Mini App has no icon', async () => {
    mocks.dataGet.mockResolvedValue([{ appId: 'iconless', name: 'Iconless' }])
    const result = await provider('core.mini-app').resolveMany([
      createSidebarShortcutTarget('core.mini-app', 'iconless')
    ])
    const resource = [...result.values()][0]
    if (!resource) throw new Error('Expected the Mini App shortcut to resolve')

    const { container } = render(resource.renderIcon({ slotSize: 18, glyphSize: 16 }))

    expect(container.querySelector('.lucide-layout-grid')).toHaveAttribute('width', '16')
    expect(container.querySelector('.lucide-layout-grid')).toHaveAttribute('height', '16')
  })

  it('keeps a configured Mini App image in the full icon slot', async () => {
    mocks.dataGet.mockResolvedValue([{ appId: 'branded', name: 'Branded', logoSrc: '/brand.png' }])
    const result = await provider('core.mini-app').resolveMany([
      createSidebarShortcutTarget('core.mini-app', 'branded')
    ])
    const resource = [...result.values()][0]
    if (!resource) throw new Error('Expected the Mini App shortcut to resolve')

    render(resource.renderIcon({ slotSize: 18, glyphSize: 16 }))

    expect(screen.getByRole('img', { name: 'Branded' })).toHaveStyle({ width: '18px', height: '18px' })
  })

  it('batch-resolves only requested topics through one exact-id query', async () => {
    mocks.dataGet.mockResolvedValue({
      items: [
        { id: 'topic-2', name: 'Second' },
        { id: 'topic-1', name: '' }
      ]
    })
    const targets = [
      createSidebarShortcutTarget('core.topic', 'topic-1'),
      createSidebarShortcutTarget('core.topic', 'topic-2')
    ]

    const result = await provider('core.topic').resolveMany(targets)

    expect(mocks.dataGet).toHaveBeenCalledWith('/topics', {
      query: { ids: ['topic-1', 'topic-2'], limit: 2 }
    })
    expect([...result.values()].map((item) => item.label)).toEqual(['Second', 'chat.conversation.new'])
  })

  it.each([
    {
      providerId: 'core.knowledge-base',
      endpoint: '/knowledge-bases',
      resourceIds: ['base-1', 'base-2'],
      items: [
        { id: 'base-2', name: 'Second base' },
        { id: 'base-1', name: 'First base' }
      ],
      labels: ['Second base', 'First base']
    },
    {
      providerId: 'core.agent-session',
      endpoint: '/agent-sessions',
      resourceIds: ['session-1', 'session-2'],
      items: [
        { id: 'session-2', name: 'Second session' },
        { id: 'session-1', name: 'First session' }
      ],
      labels: ['Second session', 'First session']
    },
    {
      providerId: 'core.file-entry',
      endpoint: '/files/entries',
      resourceIds: ['018f47d2-e657-7b4c-a7c1-8b52cbb9d114', '018f47d2-e657-7b4c-a7c1-8b52cbb9d115'],
      items: [
        { id: '018f47d2-e657-7b4c-a7c1-8b52cbb9d115', name: 'notes', ext: 'md' },
        { id: '018f47d2-e657-7b4c-a7c1-8b52cbb9d114', name: 'README', ext: null }
      ],
      labels: ['notes.md', 'README']
    }
  ])('batch-resolves requested $providerId resources by exact ids', async (fixture) => {
    mocks.dataGet.mockResolvedValue({ items: fixture.items })
    const targets = fixture.resourceIds.map((id) => createSidebarShortcutTarget(fixture.providerId, id))

    const result = await provider(fixture.providerId).resolveMany(targets)

    expect(mocks.dataGet).toHaveBeenCalledWith(fixture.endpoint, {
      query: { ids: fixture.resourceIds, limit: fixture.resourceIds.length }
    })
    expect([...result.values()].map((item) => item.label)).toEqual(fixture.labels)
  })

  it('rejects non-UUID file locators', () => {
    expect(provider('core.file-entry').validate(createSidebarShortcutTarget('core.file-entry', 'not-a-uuid'))).toBe(
      false
    )
  })

  it.each([
    ['core.knowledge-base', 'base-1', '/app/knowledge?baseId=base-1'],
    ['core.topic', 'topic-1', '/app/chat?topicId=topic-1'],
    ['core.agent-session', 'session-1', '/app/agents?sessionId=session-1'],
    ['core.code-cli', CodeCli.CLAUDE_CODE, '/app/code?tool=claude-code'],
    [
      'core.file-entry',
      '018f47d2-e657-7b4c-a7c1-8b52cbb9d114',
      '/app/files?entryId=018f47d2-e657-7b4c-a7c1-8b52cbb9d114'
    ]
  ])('matches the active reveal route for %s', (providerId, resourceId, url) => {
    const shortcutProvider = provider(providerId)

    expect(shortcutProvider.isActive?.(createSidebarShortcutTarget(providerId, resourceId), { url })).toBe(true)
  })

  it.each([
    ['core.topic', 'topic-1', '/app/chat?topicId=topic-1&view=message'],
    ['core.agent-session', 'session-1', '/app/agents?sessionId=session-1&view=message']
  ])('does not focus %s shortcuts for message-only views', (providerId, resourceId, url) => {
    const shortcutProvider = provider(providerId)

    expect(shortcutProvider.isActive?.(createSidebarShortcutTarget(providerId, resourceId), { url })).toBe(false)
  })
})
