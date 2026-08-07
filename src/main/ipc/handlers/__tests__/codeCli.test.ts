import { CodeCli } from '@shared/types/codeCli'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { codeCliHandlers } from '../codeCli'

const codeCliService = {
  run: vi.fn(),
  writeConfigFiles: vi.fn(),
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
    it('delegates the run input object to CodeCliService.run and returns the result', async () => {
      codeCliService.run.mockResolvedValue({ success: true })
      const input = {
        mode: 'normal' as const,
        cliTool: CodeCli.CLAUDE_CODE,
        model: 'gpt-4',
        providerId: 'openai',
        directory: '/tmp',
        terminal: 'iTerm2'
      }
      const result = await codeCliHandlers['code_cli.run'](input, ctx)
      expect(codeCliService.run).toHaveBeenCalledWith(input)
      expect(result).toEqual({ success: true })
    })

    it('does not accept renderer-supplied env', async () => {
      codeCliService.run.mockResolvedValue({ success: true })
      const input = {
        mode: 'normal' as const,
        cliTool: CodeCli.CLAUDE_CODE,
        model: 'gpt-4',
        providerId: 'openai',
        directory: '/tmp'
      }

      await codeCliHandlers['code_cli.run'](input, ctx)

      expect(codeCliService.run).toHaveBeenCalledWith(input)
    })

    it('allows the Claude login flow without provider or model', async () => {
      codeCliService.run.mockResolvedValue({ success: true })
      const input = {
        mode: 'login-flow' as const,
        cliTool: CodeCli.CLAUDE_CODE as const,
        directory: '/tmp'
      }

      const result = await codeCliHandlers['code_cli.run'](input, ctx)

      expect(codeCliService.run).toHaveBeenCalledWith(input)
      expect(result).toEqual({ success: true })
    })
  })

  describe('code_cli.write_config', () => {
    it('delegates cliTool and files to CodeCliService.writeConfigFiles', async () => {
      codeCliService.writeConfigFiles.mockResolvedValue(undefined)
      const input = {
        cliTool: CodeCli.CLAUDE_CODE as const,
        files: [{ target: 'claude-settings' as const, content: '{}\n' }]
      }

      const result = await codeCliHandlers['code_cli.write_config'](input, ctx)

      expect(codeCliService.writeConfigFiles).toHaveBeenCalledWith(input.cliTool, input.files)
      expect(result).toEqual({ success: true })
    })

    it('turns a thrown write error into a failed OperationResult instead of rejecting', async () => {
      codeCliService.writeConfigFiles.mockRejectedValue(new Error('disk full'))
      const input = {
        cliTool: CodeCli.OPENAI_CODEX as const,
        files: [{ target: 'codex-auth' as const, content: '{}\n' }]
      }

      await expect(codeCliHandlers['code_cli.write_config'](input, ctx)).resolves.toEqual({
        success: false,
        message: 'disk full'
      })
    })
  })

  describe('code_cli.get_available_terminals', () => {
    it('projects to { id, name }, keeping the internal bundleId off the wire', async () => {
      // The service's TerminalConfig carries a macOS bundleId for internal LaunchServices resolution; the
      // renderer never consumes it, so the handler must strip it (the router does not re-parse output).
      codeCliService.getAvailableTerminalsForPlatform.mockResolvedValue([
        { id: 'terminal', name: 'Terminal', bundleId: 'com.apple.Terminal' }
      ])
      const result = await codeCliHandlers['code_cli.get_available_terminals'](undefined, ctx)
      expect(codeCliService.getAvailableTerminalsForPlatform).toHaveBeenCalledWith()
      expect(result).toEqual([{ id: 'terminal', name: 'Terminal' }])
    })
  })
})
