import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'

const mocks = vi.hoisted(() => ({
  broadcast: vi.fn(),
  openExternal: vi.fn().mockResolvedValue(undefined),
  resolveLocalAgentCli: vi.fn()
}))

vi.mock('electron', () => ({
  shell: { openExternal: mocks.openExternal }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    IpcApiService: { broadcast: mocks.broadcast }
  })
})

vi.mock('../launch', () => ({
  resolveLocalAgentCli: mocks.resolveLocalAgentCli
}))

import { LocalAgentAuthService } from '../LocalAgentAuthService'

describe('LocalAgentAuthService', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'local-agent-auth-'))
    mocks.broadcast.mockReset()
    mocks.openExternal.mockReset().mockResolvedValue(undefined)
    mocks.resolveLocalAgentCli.mockReset()
    vi.mocked(application.getPath).mockImplementation(() => tmpDir)
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('executes CLI auth shims (.cmd on Windows, shell script on POSIX), broadcasts prompts, and supports cancellation', async () => {
    const helper = path.join(tmpDir, 'auth-helper.mjs')
    await fs.writeFile(
      helper,
      [
        'console.log("Enter code: ABCD-EFGH");',
        'console.log("https://example.invalid/device?user_code=ABCD-EFGH");',
        'if (process.argv.includes("--hang")) setInterval(() => {}, 10_000);'
      ].join('\n'),
      'utf8'
    )

    const shim = path.join(tmpDir, process.platform === 'win32' ? 'fake-cli.cmd' : 'fake-cli.sh')
    if (process.platform === 'win32') {
      await fs.writeFile(shim, `@echo off\r\n"${process.execPath}" "${helper}" %*\r\n`, 'utf8')
    } else {
      await fs.writeFile(shim, `#!/bin/sh\nexec "${process.execPath}" "${helper}" "$@"\n`, 'utf8')
      await fs.chmod(shim, 0o755)
    }

    const config: LocalAgentConfiguration = {
      presetId: 'opencode',
      protocol: 'acp',
      enabled: true,
      args: [],
      env: {}
    }
    mocks.resolveLocalAgentCli.mockResolvedValue({
      executable: shim,
      source: 'system',
      env: { ...process.env }
    })

    const service = new LocalAgentAuthService()
    await service.authenticate('req-ok', config, 'opencode-console')

    expect(mocks.broadcast).toHaveBeenCalledWith('ai.local_agents.auth_prompt', {
      requestId: 'req-ok',
      url: 'https://example.invalid/device?user_code=ABCD-EFGH',
      code: 'ABCD-EFGH'
    })
    expect(mocks.openExternal).toHaveBeenCalledWith('https://example.invalid/device?user_code=ABCD-EFGH')

    // Verify cancelling a hanging CLI auth process settles cleanly without throwing EINVAL or hanging.
    const hanging = path.join(tmpDir, process.platform === 'win32' ? 'hang-cli.cmd' : 'hang-cli.sh')
    if (process.platform === 'win32') {
      await fs.writeFile(hanging, `@echo off\r\n"${process.execPath}" "${helper}" --hang %*\r\n`, 'utf8')
    } else {
      await fs.writeFile(hanging, `#!/bin/sh\nexec "${process.execPath}" "${helper}" --hang "$@"\n`, 'utf8')
      await fs.chmod(hanging, 0o755)
    }
    mocks.resolveLocalAgentCli.mockResolvedValue({
      executable: hanging,
      source: 'system',
      env: { ...process.env }
    })

    const authPromise = service.authenticate('req-cancel', config, 'opencode-console')
    const rejection = expect(authPromise).rejects.toThrow('Authentication cancelled')
    await vi.waitFor(() =>
      expect(mocks.broadcast).toHaveBeenCalledWith(
        'ai.local_agents.auth_prompt',
        expect.objectContaining({ requestId: 'req-cancel' })
      )
    )
    await service.cancel('req-cancel')
    await rejection
  })
})
