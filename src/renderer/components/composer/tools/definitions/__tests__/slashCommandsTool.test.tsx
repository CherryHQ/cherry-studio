import { createInstance } from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import enUs from '@renderer/i18n/locales/en-us.json'
import zhCn from '@renderer/i18n/locales/zh-cn.json'

const { mockGetBuiltinSlashCommands } = vi.hoisted(() => ({
  mockGetBuiltinSlashCommands: vi.fn()
}))

vi.mock('../agentSlashCommands', () => ({
  getBuiltinSlashCommands: (...args: unknown[]) => mockGetBuiltinSlashCommands(...args)
}))

import slashCommandsTool from '../slashCommandsTool'

describe('slashCommandsTool', () => {
  beforeEach(() => {
    mockGetBuiltinSlashCommands.mockReset()
  })

  it('offers Goal independently at the root and preserves its native command', async () => {
    mockGetBuiltinSlashCommands.mockReturnValue([{ command: '/goal', description: 'Set a goal' }])
    const english = createInstance()
    await english.init({ lng: 'en-US', keySeparator: false, resources: { 'en-US': { translation: enUs } } })
    const launchers = slashCommandsTool.composer?.menuItems?.createItems({
      actions: { onTextChange: vi.fn() },
      session: { agentType: 'pi' },
      t: english.t
    } as any)
    const goal = launchers?.find((item) => item.id === 'slash-command:/goal')
    expect(goal?.label).toBe('Goal Mode')
    expect(goal?.rootPanelPlacement).toBeUndefined()
    expect(goal?.sources).toEqual(['popover', 'root-panel'])
    let text = 'Finish the report'
    const inputAdapter = {
      getText: () => text,
      insertText: (inserted: string, options?: { position?: string }) => {
        text = options?.position === 'start' ? inserted + text : text + inserted
      },
      focus: vi.fn()
    }
    goal?.action?.({ inputAdapter } as any)
    expect(text).toBe('/goal Finish the report')
    goal?.action?.({ inputAdapter } as any)
    expect(text).toBe('/goal Finish the report')
  })

  it('prefers the live session slash commands over the builtin fallback', () => {
    mockGetBuiltinSlashCommands.mockReturnValue([{ command: '/clear', description: 'builtin clear' }])

    const launchers = slashCommandsTool.composer?.menuItems?.createItems({
      actions: { onTextChange: vi.fn() },
      session: {
        agentType: 'claude-code',
        slashCommands: [
          { command: '/deploy', description: 'Deploy the app' },
          { command: '/review', description: 'Review the diff' }
        ]
      },
      t: (key: string, fallback?: string) => fallback || key
    } as any)

    // Live catalog wins — the builtin fallback is never consulted.

    expect(launchers).toEqual([
      expect.objectContaining({ id: 'slash-command:/deploy', label: '/deploy', description: 'Deploy the app' }),
      expect.objectContaining({ id: 'slash-command:/review', label: '/review', description: 'Review the diff' })
    ])
  })

  it('falls back to the builtin list when the live session catalog is empty', () => {
    mockGetBuiltinSlashCommands.mockReturnValue([{ command: '/clear', description: 'builtin clear' }])

    const launchers = slashCommandsTool.composer?.menuItems?.createItems({
      actions: { onTextChange: vi.fn() },
      session: { agentType: 'claude-code', slashCommands: [] },
      t: (key: string, fallback?: string) => fallback || key
    } as any)

    expect(launchers).toEqual([expect.objectContaining({ id: 'slash-command:/clear', label: '/clear' })])
  })

  it('translates a marked live builtin and inserts its original identifier', () => {
    const key = 'chat.input.slash_commands.commands.security_review'
    const t = vi.fn((key: string, fallback?: unknown) =>
      key === 'chat.input.slash_commands.commands.security_review'
        ? '审查待处理的更改'
        : typeof fallback === 'string'
          ? fallback
          : key
    )
    const launchers = slashCommandsTool.composer?.menuItems?.createItems({
      actions: { onTextChange: vi.fn() },
      session: { slashCommands: [{ command: '/security-review', description: 'SDK security text', builtin: true }] },
      t
    } as any)

    expect(launchers).toEqual([
      expect.objectContaining({
        label: '/security-review',
        description: '审查待处理的更改',
        searchAliases: expect.arrayContaining(['审查待处理的更改'])
      })
    ])
    expect(t).toHaveBeenCalledWith(key, 'SDK security text')
    const inputAdapter = { insertText: vi.fn(), focus: vi.fn() }
    launchers?.[0].action?.({ inputAdapter } as any)
    expect(inputAdapter.insertText).toHaveBeenCalledWith('/security-review ')
  })

  it('preserves live custom descriptions and never gives them builtin search aliases', () => {
    const t = vi.fn((key: string, fallback?: string) => fallback || key)
    const launchers = slashCommandsTool.composer?.menuItems?.createItems({
      actions: { onTextChange: vi.fn() },
      session: {
        slashCommands: [
          { command: '/clear', description: 'Plugin clear', builtin: false },
          { command: '/clear', description: 'User clear' },
          { command: '/deploy', description: 'Deploy the app' }
        ]
      },
      t
    } as any)

    expect(launchers).toEqual([
      expect.objectContaining({
        label: '/clear',
        description: 'Plugin clear',
        searchAliases: ['chat.input.slash_commands.title']
      }),
      expect.objectContaining({
        label: '/clear',
        description: 'User clear',
        searchAliases: ['chat.input.slash_commands.title']
      }),
      expect.objectContaining({ label: '/deploy', description: 'Deploy the app' })
    ])
    expect(t.mock.calls.some(([key]) => key === 'chat.input.slash_commands.commands.clear')).toBe(false)
  })

  it('keeps a marked live builtin description when its translation is missing', () => {
    const t = vi.fn((_: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : ''))
    const launchers = slashCommandsTool.composer?.menuItems?.createItems({
      actions: { onTextChange: vi.fn() },
      session: {
        slashCommands: [{ command: '/security-review', description: 'Original security text', builtin: true }]
      },
      t
    } as any)

    expect(launchers?.[0].description).toBe('Original security text')
    expect(t).toHaveBeenCalledWith('chat.input.slash_commands.commands.security_review', 'Original security text')
  })

  it('resolves real Chinese and English catalogs without translating the command label', async () => {
    const chinese = createInstance()
    const english = createInstance()
    await Promise.all([
      chinese.init({ lng: 'zh-CN', keySeparator: false, resources: { 'zh-CN': { translation: zhCn } } }),
      english.init({ lng: 'en-US', keySeparator: false, resources: { 'en-US': { translation: enUs } } })
    ])
    const descriptions = [chinese, english].map((i18n) => {
      const launchers = slashCommandsTool.composer?.menuItems?.createItems({
        actions: { onTextChange: vi.fn() },
        session: { slashCommands: [{ command: '/security-review', description: 'SDK security text', builtin: true }] },
        t: i18n.t
      } as any)
      expect(launchers?.[0].label).toBe('/security-review')
      return launchers?.[0].description
    })

    expect(descriptions).toEqual([
      '对当前分支中待处理的更改进行安全审查',
      'Complete a security review of the pending changes on the current branch'
    ])
  })
})
