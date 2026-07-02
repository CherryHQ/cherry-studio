import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { codeCliHandlers } from '../codeCli'

const codeCliService = {
  run: vi.fn(),
  getAvailableTerminalsForPlatform: vi.fn(),
  setCustomTerminalPath: vi.fn(),
  getCustomTerminalPath: vi.fn(),
  removeCustomTerminalPath: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'CodeCliService') return codeCliService
    throw new Error(`Unexpected application.get(${name})`)
  })
})

const ctx = { senderId: 'w1' }

describe('codeCliHandlers', () => {
  describe('code_cli.run', () => {
    it('delegates to CodeCliService.run and returns the result', async () => {
      codeCliService.run.mockResolvedValue({ success: true, message: 'ok', command: 'claude' })
      const input = {
        cliTool: 'claude-code',
        model: 'gpt-4',
        providerId: 'openai',
        directory: '/tmp',
        env: { FOO: 'bar' },
        options: { terminal: 'iTerm2' }
      }
      const result = await codeCliHandlers['code_cli.run'](input, ctx)
      expect(codeCliService.run).toHaveBeenCalledWith(
        'claude-code',
        'gpt-4',
        'openai',
        '/tmp',
        { FOO: 'bar' },
        { terminal: 'iTerm2' }
      )
      expect(result).toEqual({ success: true, message: 'ok', command: 'claude' })
    })
  })

  describe('code_cli.get_available_terminals', () => {
    it('delegates to CodeCliService.getAvailableTerminalsForPlatform', async () => {
      const terminals = [{ id: 'terminal', name: 'Terminal' }]
      codeCliService.getAvailableTerminalsForPlatform.mockResolvedValue(terminals)
      const result = await codeCliHandlers['code_cli.get_available_terminals'](undefined, ctx)
      expect(codeCliService.getAvailableTerminalsForPlatform).toHaveBeenCalledWith()
      expect(result).toEqual(terminals)
    })
  })

  describe('code_cli.set_custom_terminal_path', () => {
    it('delegates to CodeCliService.setCustomTerminalPath', async () => {
      await codeCliHandlers['code_cli.set_custom_terminal_path'](
        { terminalId: 'iTerm2', path: '/usr/local/bin/iterm2' },
        ctx
      )
      expect(codeCliService.setCustomTerminalPath).toHaveBeenCalledWith('iTerm2', '/usr/local/bin/iterm2')
    })
  })

  describe('code_cli.get_custom_terminal_path', () => {
    it('delegates to CodeCliService.getCustomTerminalPath', async () => {
      codeCliService.getCustomTerminalPath.mockReturnValue('/custom/path')
      const result = await codeCliHandlers['code_cli.get_custom_terminal_path']({ terminalId: 'kitty' }, ctx)
      expect(codeCliService.getCustomTerminalPath).toHaveBeenCalledWith('kitty')
      expect(result).toBe('/custom/path')
    })

    it('returns undefined when no custom path is set', async () => {
      codeCliService.getCustomTerminalPath.mockReturnValue(undefined)
      const result = await codeCliHandlers['code_cli.get_custom_terminal_path']({ terminalId: 'kitty' }, ctx)
      expect(result).toBeUndefined()
    })
  })

  describe('code_cli.remove_custom_terminal_path', () => {
    it('delegates to CodeCliService.removeCustomTerminalPath', async () => {
      await codeCliHandlers['code_cli.remove_custom_terminal_path']({ terminalId: 'wezterm' }, ctx)
      expect(codeCliService.removeCustomTerminalPath).toHaveBeenCalledWith('wezterm')
    })
  })
})
