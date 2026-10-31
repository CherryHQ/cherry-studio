import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { codeCliRequestSchemas } from '@shared/ipc/schemas/codeCli'
import { CodeCli } from '@shared/types/codeCli'

import { codeCliHandlers } from '../codeCli'

const codeCliService = Object.assign(application.get('CodeCliService'), {
  run: vi.fn(),
  updateConfigFiles: vi.fn(),
  readConfigFiles: vi.fn(),
  getAvailableTerminalsForPlatform: vi.fn()
})

beforeEach(() => {
  vi.clearAllMocks()
})

const ctx = { senderId: 'w1' }

describe('codeCliHandlers', () => {
  describe('code_cli.read_config', () => {
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
    it('turns a thrown write error into a failed OperationResult instead of rejecting', async () => {
      codeCliService.updateConfigFiles.mockRejectedValue(new Error('disk full'))
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
      expect(result).toEqual([{ id: 'terminal', name: 'Terminal' }])
    })
  })
})
