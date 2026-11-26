import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import type { RuntimeLoginHost } from '@cherrystudio/agent-runtime'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  authenticateCursor: vi.fn(),
  openExternal: vi.fn().mockResolvedValue(undefined),
  resolveLocalAgentCli: vi.fn()
}))

vi.mock('@cherrystudio/agent-runtime-cursor', () => ({
  bindCursorAccount: () => ({ authenticate: mocks.authenticateCursor })
}))

vi.mock('electron', () => ({
  shell: { openExternal: mocks.openExternal }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    IpcApiService: { send: mocks.send }
  })
})

vi.mock('../codeCli/localAgentCli', () => ({
  resolveLocalAgentCli: mocks.resolveLocalAgentCli
}))

import { LocalAgentAuthService } from '../LocalAgentAuthService'

describe('LocalAgentAuthService', () => {
  const service = new LocalAgentAuthService()
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'local-agent-auth-'))
    mocks.send.mockReset()
    mocks.authenticateCursor.mockReset()
    mocks.openExternal.mockReset().mockResolvedValue(undefined)
    mocks.resolveLocalAgentCli.mockReset()
    vi.mocked(application.getPath).mockImplementation(() => tmpDir)
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('redacts rejected runtime credentials', async () => {
    const config: LocalAgentConfiguration = {
      presetId: 'cursor',
      enabled: false,
      args: [],
      env: { CURSOR_API_KEY: 'test-cursor-key' }
    }
    mocks.authenticateCursor.mockRejectedValueOnce(new Error('Invalid API key: test-cursor-key'))
    await expect(service.authenticate('invalid-key', config, 'cursor_api_key')).rejects.toThrow(
      /^Invalid API key: <redacted>$/
    )
  })

  it('only opens the displayed login URL after consent to that prompt from the initiating window', async () => {
    const config: LocalAgentConfiguration = { presetId: 'cursor', enabled: false, args: [], env: {} }
    const url = 'https://example.invalid/device'
    const { promise: prompted, resolve } = Promise.withResolvers<string>()
    mocks.send.mockImplementation((_, event, payload) => {
      if (event === 'ai.local_agents.auth_consent' && payload.prompt) resolve(payload.promptId)
    })
    mocks.authenticateCursor.mockImplementation(async (_, host: RuntimeLoginHost, signal: AbortSignal) => {
      expect(await host.confirmBrowser?.({ url, message: 'Approve the browser sign-in' }, signal)).toBe('accept')
    })

    const authentication = service.authenticate('browser-login', config, 'cursor_browser', undefined, 'origin')
    const promptId = await prompted
    service.respondToBrowserConsent('browser-login', promptId, 'decline', 'another-window')
    service.respondToBrowserConsent('browser-login', 'another-prompt', 'decline', 'origin')
    expect(mocks.openExternal).not.toHaveBeenCalled()
    service.respondToBrowserConsent('browser-login', promptId, 'accept', 'origin')

    await authentication
    expect(mocks.openExternal).toHaveBeenCalledExactlyOnceWith(url)
  })

  it('executes CLI auth shims (.cmd on Windows, shell script on POSIX), routes prompts to the requesting window and supports cancellation', async () => {
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
      enabled: true,
      args: [],
      env: {}
    }
    mocks.resolveLocalAgentCli.mockResolvedValue({
      executable: shim,
      source: 'system',
      env: { ...process.env }
    })

    await service.authenticate('req-ok', config, 'opencode-console', undefined, 'origin')

    expect(mocks.send).toHaveBeenCalledWith('origin', 'ai.local_agents.auth_prompt', {
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

    const authPromise = service.authenticate('req-cancel', config, 'opencode-console', undefined, 'origin')
    const rejection = expect(authPromise).rejects.toThrow('Authentication cancelled')
    await vi.waitFor(() =>
      expect(mocks.send).toHaveBeenCalledWith(
        'origin',
        'ai.local_agents.auth_prompt',
        expect.objectContaining({ requestId: 'req-cancel' })
      )
    )
    await service.cancel('req-cancel', 'other-window')
    await service.cancel('req-cancel', 'origin')
    await rejection
  })
})
