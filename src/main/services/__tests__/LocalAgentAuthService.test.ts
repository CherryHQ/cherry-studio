import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import type { RuntimeLoginHost } from '@cherrystudio/agent-runtime'
import { cursorLoginMethod } from '@cherrystudio/agent-runtime-cursor/cli'
import { agentService } from '@data/services/AgentService'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  authenticateCursor: vi.fn(),
  readCursorAccount: vi.fn(),
  readCursorQuota: vi.fn(),
  openExternal: vi.fn().mockResolvedValue(undefined),
  resolveLocalAgentCli: vi.fn()
}))

vi.mock('@cherrystudio/agent-runtime-cursor', () => ({
  bindCursorAccount: () => ({
    authenticate: mocks.authenticateCursor,
    readAccount: mocks.readCursorAccount,
    readSubscriptionUsage: mocks.readCursorQuota
  })
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
  setupTestDatabase()
  const service = new LocalAgentAuthService()
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'local-agent-auth-'))
    mocks.send.mockReset()
    mocks.authenticateCursor.mockReset()
    mocks.readCursorAccount.mockReset().mockResolvedValue({ status: 'unknown' })
    mocks.readCursorQuota.mockReset()
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

    const authentication = service.authenticate('browser-login', config, cursorLoginMethod.id, undefined, 'origin')
    const promptId = await prompted
    service.respondToBrowserConsent('browser-login', promptId, 'decline', 'another-window')
    service.respondToBrowserConsent('browser-login', 'another-prompt', 'decline', 'origin')
    expect(mocks.openExternal).not.toHaveBeenCalled()
    service.respondToBrowserConsent('browser-login', promptId, 'accept', 'origin')

    await authentication
    expect(mocks.openExternal).toHaveBeenCalledExactlyOnceWith(url)
  })

  it('attaches the confirmed login and keeps a model change made during sign-in', async () => {
    const config: LocalAgentConfiguration = { presetId: 'cursor', enabled: true, args: [], env: { PAGER: 'cat' } }
    const agent = agentService.createAgentWithId('saved-cursor', {
      name: 'Cursor',
      type: 'local',
      model: null,
      localRuntime: { ...config, account: { methodId: cursorLoginMethod.id, accountId: 'previous' } }
    })
    mocks.readCursorAccount.mockResolvedValue({ status: 'signed-in', account: { id: 'personal' } })
    const started = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<void>()
    mocks.authenticateCursor.mockImplementationOnce(() => {
      started.resolve()
      return finish.promise
    })

    const signingIn = service.authenticate(
      'browser-login',
      { ...config, presetId: 'opencode', env: { PAGER: 'false' } },
      cursorLoginMethod.id,
      undefined,
      'origin',
      agent.id
    )
    await started.promise
    agentService.updateAgent(agent.id, { localRuntime: { nativeModel: 'new-model' } })
    finish.resolve()
    await signingIn

    expect(agentService.getAgent(agent.id)?.localRuntime).toMatchObject({
      providerId: agent.localRuntime!.providerId,
      presetId: 'cursor',
      env: { PAGER: 'cat' },
      nativeModel: 'new-model',
      account: { methodId: cursorLoginMethod.id, accountId: 'personal' }
    })
  })

  it('rejects the login write if the Agent now uses a different provider', async () => {
    const config: LocalAgentConfiguration = { presetId: 'cursor', enabled: true, args: [], env: { PAGER: 'cat' } }
    const agent = agentService.createAgentWithId('switching-cursor', {
      name: 'Cursor',
      type: 'local',
      model: null,
      localRuntime: config
    })
    const started = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<void>()
    mocks.authenticateCursor.mockImplementationOnce(() => {
      started.resolve()
      return finish.promise
    })
    mocks.readCursorAccount.mockResolvedValue({ status: 'signed-in', account: { id: 'personal' } })

    const signingIn = service.authenticate('switch-login', config, cursorLoginMethod.id, undefined, 'origin', agent.id)
    await started.promise
    const switched = agentService.updateAgent(agent.id, { localRuntime: { env: { PAGER: 'more' } } })
    finish.resolve()

    await expect(signingIn).rejects.toThrow('Local agent connection changed during sign-in')
    expect(agentService.getAgent(agent.id)?.localRuntime).toEqual(switched?.localRuntime)
  })

  it.each([
    { patch: { browserControl: 'readonly' as const }, expected: 'available' },
    { patch: { nativeModel: 'new-model' }, expected: 'unavailable' }
  ])('rechecks the quota route after saving $patch', async ({ patch, expected }) => {
    const agent = agentService.createAgentWithId('quota-route', {
      name: 'Cursor',
      type: 'local',
      model: null,
      localRuntime: { presetId: 'cursor', enabled: true, nativeModel: 'original-model' }
    })
    const started = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<void>()
    mocks.readCursorQuota.mockImplementationOnce(async () => {
      started.resolve()
      await finish.promise
      return { status: 'available', readAt: 1, windows: [] }
    })

    const reading = service.readSubscriptionUsage(agent.id)
    await started.promise
    agentService.updateAgent(agent.id, { localRuntime: patch })
    finish.resolve()

    await expect(reading).resolves.toMatchObject({ status: expected })
  })

  it('discards subscription quota if the bound account changes while the request is in flight', async () => {
    const agent = agentService.createAgentWithId('quota-cursor', {
      name: 'Cursor',
      type: 'local',
      model: null,
      localRuntime: {
        presetId: 'cursor',
        enabled: true,
        args: [],
        env: {},
        account: { methodId: cursorLoginMethod.id, accountId: 'personal' }
      }
    })
    mocks.readCursorAccount
      .mockResolvedValueOnce({ status: 'signed-in', account: { id: 'personal' } })
      .mockResolvedValueOnce({ status: 'signed-in', account: { id: 'work' } })
    mocks.readCursorQuota.mockResolvedValue({ status: 'available', readAt: 1, windows: [] })

    await expect(service.readSubscriptionUsage(agent.id)).resolves.toEqual({ status: 'unavailable' })
  })

  it('executes CLI auth shims (.cmd on Windows, shell script on POSIX), routes prompts to the requesting window and supports cancellation', async () => {
    const helper = path.join(tmpDir, 'auth-helper.mjs')
    await fs.writeFile(
      helper,
      [
        'if (process.argv[3] === "list") {',
        '  console.log(JSON.stringify([{ id: "opencode", connections: [{ type: "credential" }] }]));',
        '  process.exit(0);',
        '}',
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

    const { promise: cancelPrompt, resolve: confirmedPrompt } = Promise.withResolvers<void>()
    mocks.send.mockImplementation((windowId, event, payload) => {
      if (windowId === 'origin' && event === 'ai.local_agents.auth_prompt' && payload.requestId === 'req-cancel')
        confirmedPrompt()
    })
    const authPromise = service.authenticate('req-cancel', config, 'opencode-console', undefined, 'origin')
    const rejection = expect(authPromise).rejects.toThrow('Authentication cancelled')
    await cancelPrompt
    await service.cancel('req-cancel', 'other-window')
    await service.cancel('req-cancel', 'origin')
    await rejection
  })
})
