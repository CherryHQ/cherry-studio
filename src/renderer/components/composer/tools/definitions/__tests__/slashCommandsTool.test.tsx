import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetBuiltinSlashCommands } = vi.hoisted(() => ({
  mockGetBuiltinSlashCommands: vi.fn()
}))

vi.mock('@shared/ai/agentSlashCommands', () => ({
  getBuiltinSlashCommands: (...args: unknown[]) => mockGetBuiltinSlashCommands(...args)
}))

import slashCommandsTool from '../slashCommandsTool'

describe('slashCommandsTool', () => {
  beforeEach(() => {
    mockGetBuiltinSlashCommands.mockReset()
  })

  it('keeps slash commands out of the plus popover menu while preserving root-panel commands', () => {
    mockGetBuiltinSlashCommands.mockReturnValue([{ command: '/clear', description: 'Clear context' }])
    const quickPanel = { open: vi.fn() }

    const launchers = slashCommandsTool.composer?.menuItems?.createItems({
      actions: { onTextChange: vi.fn() },
      session: { agentType: 'claude-code' },
      t: (key: string, fallback?: string) => fallback || key
    } as any)

    expect(launchers).toEqual([
      expect.objectContaining({
        id: 'slash-commands',
        label: 'chat.input.slash_commands.title',
        sources: [],
        submenu: [
          expect.objectContaining({
            id: 'slash-command:/clear',
            label: '/clear',
            sources: ['root-panel']
          })
        ]
      })
    ])
    expect(launchers?.[0].submenu?.some((launcher) => launcher.sources?.includes('popover'))).toBe(false)

    launchers?.[0].action?.({
      quickPanel,
      source: 'popover'
    } as any)

    expect(quickPanel.open).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'slash-commands',
        list: [expect.objectContaining({ label: '/clear', description: 'Clear context' })]
      })
    )
  })

  it('translates builtin command descriptions via renderer-local keys', () => {
    mockGetBuiltinSlashCommands.mockReturnValue([
      { command: '/clear', description: 'Clear conversation history' },
      { command: '/custom', description: 'Custom command' }
    ])
    const t = vi.fn((key: string, fallback?: string) =>
      key === 'chat.input.slash_commands.commands.clear' ? 'Translated clear command' : fallback || key
    )

    const launchers = slashCommandsTool.composer?.menuItems?.createItems({
      actions: { onTextChange: vi.fn() },
      session: { agentType: 'claude-code' },
      t
    } as any)

    expect(launchers?.[0].submenu).toEqual([
      expect.objectContaining({ label: '/clear', description: 'Translated clear command' }),
      expect.objectContaining({ label: '/custom', description: 'Custom command' })
    ])
    expect(t).toHaveBeenCalledWith('chat.input.slash_commands.commands.clear', 'Clear conversation history')
  })

  it('falls back to command descriptions when a mapped translation is missing', () => {
    mockGetBuiltinSlashCommands.mockReturnValue([{ command: '/clear', description: 'Clear conversation history' }])
    const t = vi.fn((_: string, fallback?: string) => fallback || '')

    const launchers = slashCommandsTool.composer?.menuItems?.createItems({
      actions: { onTextChange: vi.fn() },
      session: { agentType: 'claude-code' },
      t
    } as any)

    expect(launchers?.[0].submenu).toEqual([
      expect.objectContaining({ label: '/clear', description: 'Clear conversation history' })
    ])
    expect(t).toHaveBeenCalledWith('chat.input.slash_commands.commands.clear', 'Clear conversation history')
  })
})
