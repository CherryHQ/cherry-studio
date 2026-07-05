import { CodeCli } from '@shared/types/codeCli'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CliConfigFileDraft } from '../index'
import { writeCliConfigDraft } from '../index'

const codexConfigDraft: CliConfigFileDraft = {
  target: 'codex-config',
  label: 'Codex config.toml',
  path: '/tmp/cherry/.codex/config.toml',
  language: 'toml',
  content: 'model = "gpt-5"\n'
}

const codexAuthDraft: CliConfigFileDraft = {
  target: 'codex-auth',
  label: 'Codex auth.json',
  path: '/tmp/cherry/.codex/auth.json',
  language: 'json',
  content: '{ "OPENAI_API_KEY": "sk-secret" }\n'
}

describe('writeCliConfigDraft', () => {
  let existing: Record<string, string>

  beforeEach(() => {
    existing = {}
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        resolvePath: vi.fn(async (p: string) => `/resolved${p}`),
        file: {
          readExternal: vi.fn(async (p: string) => {
            if (p in existing) return existing[p]
            throw new Error(`File does not exist: ${p}`)
          }),
          mkdir: vi.fn(async () => undefined),
          write: vi.fn(async () => undefined),
          deleteExternalFile: vi.fn(async () => undefined)
        }
      }
    })
  })

  it('ensures parent directories before writing every draft file', async () => {
    await writeCliConfigDraft({
      cliTool: CodeCli.OPENAI_CODEX,
      files: [codexConfigDraft, codexAuthDraft]
    })

    const mkdirMock = vi.mocked(window.api.file.mkdir)
    const writeMock = vi.mocked(window.api.file.write)
    expect(mkdirMock).toHaveBeenNthCalledWith(1, '/tmp/cherry/.codex')
    expect(mkdirMock).toHaveBeenNthCalledWith(2, '/tmp/cherry/.codex')
    expect(mkdirMock.mock.invocationCallOrder[0]).toBeLessThan(writeMock.mock.invocationCallOrder[0])
    expect(mkdirMock.mock.invocationCallOrder[1]).toBeLessThan(writeMock.mock.invocationCallOrder[1])
  })

  // Config files carry secrets (auth tokens, API keys) — they must never be written world-readable.
  it('writes every config file with 0600 permissions', async () => {
    await writeCliConfigDraft({
      cliTool: CodeCli.OPENAI_CODEX,
      files: [codexConfigDraft, codexAuthDraft]
    })

    const writeMock = vi.mocked(window.api.file.write)
    expect(writeMock).toHaveBeenCalledWith(codexConfigDraft.path, codexConfigDraft.content, 0o600)
    expect(writeMock).toHaveBeenCalledWith(codexAuthDraft.path, codexAuthDraft.content, 0o600)
  })

  it('ensures parent directories before rollback writes', async () => {
    existing[codexConfigDraft.path] = 'user_key = "keep"\n'
    vi.mocked(window.api.file.write).mockImplementation(async (p: string) => {
      if (p === codexAuthDraft.path) throw new Error('write failed')
    })

    await expect(
      writeCliConfigDraft({
        cliTool: CodeCli.OPENAI_CODEX,
        files: [codexConfigDraft, codexAuthDraft]
      })
    ).rejects.toThrow('write failed')

    const mkdirMock = vi.mocked(window.api.file.mkdir)
    expect(window.api.file.deleteExternalFile).toHaveBeenCalledWith(codexAuthDraft.path)
    expect(window.api.file.write).toHaveBeenLastCalledWith(codexConfigDraft.path, 'user_key = "keep"\n', 0o600)
    expect(mkdirMock).toHaveBeenLastCalledWith('/tmp/cherry/.codex')
  })

  // A restore write can itself fail (disk full, permission denied, etc.) — that failure must be
  // logged, not thrown in place of the original write error, and must not abort the remaining
  // rollbacks in the chain (S1: the restore branch previously had no .catch, unlike delete).
  it('surfaces the original write error (not a restore failure) and still rolls back the rest', async () => {
    const openCodeConfigDraft: CliConfigFileDraft = {
      target: 'opencode-config',
      label: 'OpenCode config',
      path: '/tmp/cherry/.config/opencode/opencode.json',
      language: 'json',
      content: '{ "new": true }\n'
    }
    existing[codexConfigDraft.path] = 'user_key = "keep"\n'
    existing[codexAuthDraft.path] = '{ "user": "keep" }\n'
    // Write order: codexConfigDraft (ok), codexAuthDraft (ok), openCodeConfigDraft (fails) → rollback
    // in reverse: openCodeConfigDraft (delete, new file), codexAuthDraft (restore, fails), then
    // codexConfigDraft (restore, must still run despite the previous restore failure).
    vi.mocked(window.api.file.write).mockImplementationOnce(async () => undefined) // codexConfigDraft write
    vi.mocked(window.api.file.write).mockImplementationOnce(async () => undefined) // codexAuthDraft write
    vi.mocked(window.api.file.write).mockImplementationOnce(async () => {
      throw new Error('disk full')
    }) // openCodeConfigDraft write fails
    vi.mocked(window.api.file.write).mockImplementationOnce(async () => {
      throw new Error('restore failed: disk still full')
    }) // rollback restore of codexAuthDraft fails

    await expect(
      writeCliConfigDraft({
        cliTool: CodeCli.OPENAI_CODEX,
        files: [codexConfigDraft, codexAuthDraft, openCodeConfigDraft]
      })
    ).rejects.toThrow('disk full')

    // codexConfigDraft (rolled back last, since rollback order is reversed) must still be restored
    // even though codexAuthDraft's restore failed first in the chain.
    expect(window.api.file.write).toHaveBeenLastCalledWith(codexConfigDraft.path, 'user_key = "keep"\n', 0o600)
  })
})
