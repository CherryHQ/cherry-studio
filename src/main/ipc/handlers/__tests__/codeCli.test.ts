import { beforeEach, describe, expect, it, vi } from 'vitest'

import { codeCliRequestSchemas } from '@shared/ipc/schemas/codeCli'
import { CodeCli } from '@shared/types/codeCli'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { codeCliHandlers } from '../codeCli'

const codeCliService = {
  run: vi.fn(),
  writeConfigFiles: vi.fn(),
  readConfigFiles: vi.fn(),
  getAvailableTerminalsForPlatform: vi.fn()
}
const analytics = { trackProductEvent: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'CodeCliService') return codeCliService
    if (name === 'AnalyticsService') return analytics
    throw new Error(`Unexpected application.get(${name})`)
  })
})

const ctx = { senderId: 'w1' }

describe('codeCliHandlers', () => {
  describe('code_cli.read_config', () => {
    it('delegates targets to CodeCliService.readConfigFiles and wraps the files', async () => {
      const files = [{ target: 'claude-settings' as const, path: '/home/u/.claude/settings.json', content: '{}\n' }]
      codeCliService.readConfigFiles.mockResolvedValue(files)

      const result = await codeCliHandlers['code_cli.read_config']({ targets: ['claude-settings'] }, ctx)

      expect(codeCliService.readConfigFiles).toHaveBeenCalledWith(['claude-settings'])
      expect(result).toEqual({ files })
    })

    it('propagates non-ENOENT read errors to the router error model instead of swallowing them', async () => {
      codeCliService.readConfigFiles.mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }))

      await expect(codeCliHandlers['code_cli.read_config']({ targets: ['codex-auth'] }, ctx)).rejects.toThrow('EACCES')
    })
  })

  describe('code_cli.read_config schema', () => {
    it('rejects a target outside the enum allow-list', () => {
      const parsed = codeCliRequestSchemas['code_cli.read_config'].input.safeParse({
        targets: ['claude-settings', '/etc/passwd']
      })
      expect(parsed.success).toBe(false)
    })

    it('deduplicates repeated targets, keeping the first occurrence order', () => {
      const parsed = codeCliRequestSchemas['code_cli.read_config'].input.safeParse({
        targets: ['claude-settings', 'codex-config', 'claude-settings']
      })
      expect(parsed.success).toBe(true)
      if (parsed.success) expect(parsed.data.targets).toEqual(['claude-settings', 'codex-config'])
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

  describe('code_cli.run analytics', () => {
    const input = {
      cliTool: CodeCli.QWEN_CODE as const,
      mode: 'normal' as const,
      directory: '/Users/someone/private-project',
      providerId: 'my-provider',
      model: 'my-model'
    }
    const launchEvents = () =>
      analytics.trackProductEvent.mock.calls.map(([event]) => event).filter((event) => event.feature === 'code')

    it.each([
      ['success', { success: true }],
      ['error', { success: false, message: 'Directory does not exist' }]
    ] as const)('reports a %s launch with only the preset tool id', async (status, outcome) => {
      codeCliService.run.mockResolvedValue(outcome)

      await expect(codeCliHandlers['code_cli.run'](input, ctx)).resolves.toEqual(outcome)

      expect(launchEvents()).toEqual([
        {
          event: 'feature_used',
          feature: 'code',
          action: 'cli_launched',
          status,
          target: 'qwen-code',
          modelSource: 'own_key'
        }
      ])
    })

    it('names no model source when the tool runs on its own login', async () => {
      codeCliService.run.mockResolvedValue({ success: true })

      await codeCliHandlers['code_cli.run']({ cliTool: CodeCli.QWEN_CODE, mode: 'own-login', directory: '/p' }, ctx)

      expect(launchEvents()).toEqual([
        { event: 'feature_used', feature: 'code', action: 'cli_launched', status: 'success', target: 'qwen-code' }
      ])
    })

    it('reports a thrown launch as an error and still rejects', async () => {
      codeCliService.run.mockRejectedValue(new Error('spawn failed'))

      await expect(codeCliHandlers['code_cli.run'](input, ctx)).rejects.toThrow('spawn failed')

      expect(launchEvents()).toEqual([
        {
          event: 'feature_used',
          feature: 'code',
          action: 'cli_launched',
          status: 'error',
          target: 'qwen-code',
          modelSource: 'own_key'
        }
      ])
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

      expect(result).toEqual([{ id: 'terminal', name: 'Terminal' }])
    })
  })
})
