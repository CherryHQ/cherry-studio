import { CodeCli } from '@shared/types/codeCli'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CliConfigFileDraft } from '../index'
import { writeCliConfigDraft } from '../index'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.request }
}))

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

/**
 * Renderer contract of the write path: drafts are validated locally, then the
 * batch crosses to the main process as `{ target, content }` only — path
 * resolution, atomic 0600 writes, and snapshot/rollback are main-side
 * properties, pinned in configWriter tests.
 */
describe('writeCliConfigDraft', () => {
  beforeEach(() => {
    mocks.request.mockReset()
    mocks.request.mockResolvedValue({ success: true })
  })

  it('sends the whole draft batch over code_cli.write_config, in order, without paths', async () => {
    await writeCliConfigDraft({
      cliTool: CodeCli.OPENAI_CODEX,
      files: [codexConfigDraft, codexAuthDraft]
    })

    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.request).toHaveBeenCalledWith('code_cli.write_config', {
      cliTool: CodeCli.OPENAI_CODEX,
      files: [
        { target: 'codex-config', content: codexConfigDraft.content },
        { target: 'codex-auth', content: codexAuthDraft.content }
      ]
    })
  })

  it('throws the main-process failure message when the write is rejected', async () => {
    mocks.request.mockResolvedValue({ success: false, message: 'disk full' })

    await expect(
      writeCliConfigDraft({
        cliTool: CodeCli.OPENAI_CODEX,
        files: [codexConfigDraft]
      })
    ).rejects.toThrow('disk full')
  })

  it('rejects an unparsable draft before anything crosses the IPC boundary', async () => {
    await expect(
      writeCliConfigDraft({
        cliTool: CodeCli.OPENAI_CODEX,
        files: [{ ...codexConfigDraft, content: 'this is = = not valid toml [[[' }]
      })
    ).rejects.toThrow(/Invalid TOML/)
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('rejects a tool without config files instead of sending IPC', async () => {
    await expect(
      writeCliConfigDraft({
        cliTool: CodeCli.QODER_CLI,
        files: [codexConfigDraft]
      })
    ).rejects.toThrow(/does not use config files/)
    expect(mocks.request).not.toHaveBeenCalled()
  })
})
