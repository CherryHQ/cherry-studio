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
    expect(window.api.file.write).toHaveBeenLastCalledWith(codexConfigDraft.path, 'user_key = "keep"\n')
    expect(mkdirMock).toHaveBeenLastCalledWith('/tmp/cherry/.codex')
  })
})
