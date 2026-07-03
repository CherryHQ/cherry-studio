import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { codeCliHandlers } from '../codeCli'

const codeCliService = {
  run: vi.fn(),
  getAvailableTerminalsForPlatform: vi.fn()
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
        options: { terminal: 'iTerm2' }
      }
      const result = await codeCliHandlers['code_cli.run'](input, ctx)
      expect(codeCliService.run).toHaveBeenCalledWith('claude-code', 'gpt-4', 'openai', '/tmp', { terminal: 'iTerm2' })
      expect(result).toEqual({ success: true, message: 'ok', command: 'claude' })
    })

    it('does not accept renderer-supplied env', async () => {
      codeCliService.run.mockResolvedValue({ success: true, message: 'ok', command: 'claude' })
      const input = {
        cliTool: 'claude-code',
        model: 'gpt-4',
        providerId: 'openai',
        directory: '/tmp',
        options: {}
      }

      await codeCliHandlers['code_cli.run'](input, ctx)

      expect(codeCliService.run).toHaveBeenCalledWith('claude-code', 'gpt-4', 'openai', '/tmp', {})
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
})
