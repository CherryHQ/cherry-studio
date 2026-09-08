import type { BridgeResult } from '@shared/ipc/schemas/miniAppBridge'
import { describe, expect, it, vi } from 'vitest'

import { mockMiniAppApplication } from '../../__tests__/applicationMock'

const resolveAppIdBySender = vi.fn()
const beginCapabilityCall = vi.fn()
const assertMethodAllowed = vi.fn()
const recordCall = vi.fn()

// Hoisted out of the factory so a test can THROW it: `publicErrorOf` maps by
// `instanceof`, and a class trapped inside the factory is unreachable from a test.
class PermissionDeniedError extends Error {}
vi.mock('../../grants', () => ({ assertMethodAllowed, PermissionDeniedError }))
vi.mock('../../activityLog', () => ({ miniAppActivityLog: { recordCall } }))
vi.mock('@application', () =>
  mockMiniAppApplication({
    MiniAppRuntimeService: { resolveAppIdBySender, beginCapabilityCall },
    PreferenceService: { get: () => 'zh-CN' },
    DbService: {
      getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ all: () => [{ version: '1.0.0' }] }) }) }) })
    }
  })
)

const storageSet = vi.fn(() => ({ ok: true }))
const storageKeys = vi.fn()
vi.mock('../../capabilities/storage', () => ({
  storageCapability: { set: storageSet, get: vi.fn(), delete: vi.fn(), keys: storageKeys, usage: vi.fn() }
}))
vi.mock('../../capabilities/file', () => ({
  fileCapability: { save: vi.fn(), load: vi.fn(), list: vi.fn(), delete: vi.fn(), usage: vi.fn() }
}))
const aiChat = vi.fn()
vi.mock('../../capabilities/ai', () => ({ aiCapability: { chat: aiChat, getCapabilities: vi.fn() } }))
vi.mock('../../capabilities/notification', () => ({ notificationCapability: { show: vi.fn() } }))

const { handleBridgeRequest, publicErrorOf } = await import('../bridge')
const { MiniAppQuiescingError } = await import('../MiniAppRuntimeService')
const { RateLimitedError } = await import('../../capabilities/quota')
const { MiniAppUnavailableError } = await import('../../errors')

const noopEmit = () => {}

/**
 * Narrows the envelope AND names the failure. `BridgeResult` is a discriminated union,
 * so `result.value` does not typecheck unquantified — and a bare `as { ok: true }` cast
 * silences that by reporting `expected undefined to be …`, which says nothing about why.
 */
function expectOk(result: BridgeResult): unknown {
  if (result.ok) return result.value
  throw new Error(`expected ok, got ${result.error.name}: ${result.error.message}`)
}

describe('handleBridgeRequest', () => {
  it('records every attributable call with its public outcome, the refused ones included', async () => {
    // The bug this guards: logging only after the gate. An app probing what it was not
    // granted is exactly the line the activity log exists to show.
    recordCall.mockClear()
    resolveAppIdBySender.mockReturnValue('com.example.a')
    assertMethodAllowed.mockImplementationOnce(() => {
      throw new PermissionDeniedError('nope')
    })

    await handleBridgeRequest(1, { method: 'storage.set', params: { key: 'k', value: 'v' } }, noopEmit)
    await handleBridgeRequest(1, { method: 'storage.set', params: { key: 'k', value: 'v' } }, noopEmit)

    expect(recordCall.mock.calls.map((c) => [c[0], c[1], c[2]])).toEqual([
      ['com.example.a', 'storage.set', 'PermissionDenied'],
      ['com.example.a', 'storage.set', 'ok']
    ])
    // A sender that is not a guest is not attributable and is not logged.
    recordCall.mockClear()
    resolveAppIdBySender.mockReturnValue(undefined)
    await handleBridgeRequest(99, { method: 'storage.set' }, noopEmit)
    expect(recordCall).not.toHaveBeenCalled()
  })

  it('logs what failed underneath an Unavailable, and only to the user', async () => {
    // Both a dead provider and a cleared app reject `Unavailable`, and the seven public
    // names cannot separate them — the user's own panel is where that question is asked.
    recordCall.mockClear()
    resolveAppIdBySender.mockReturnValue('com.example.a')
    assertMethodAllowed.mockImplementationOnce(() => {
      throw new MiniAppUnavailableError('The model could not complete the request', { cause: 'AI_APICallError' })
    })

    const result = await handleBridgeRequest(1, { method: 'ai.chat', params: {} }, noopEmit)

    expect(recordCall.mock.calls[0]?.[6]).toBe('AI_APICallError')
    // And nowhere near the envelope the guest reads.
    expect(JSON.stringify(result)).not.toContain('AI_APICallError')
  })

  it('rejects a sender that is not a registered guest', async () => {
    resolveAppIdBySender.mockReturnValue(undefined)

    // RESOLVES with a failure envelope, never rejects: `ipcMain.handle` erases `name`
    // (`electron.d.ts:8877`). `Internal` also hides whether a guest registry exists.
    await expect(handleBridgeRequest(99, { method: 'storage.keys' }, noopEmit)).resolves.toEqual({
      ok: false,
      error: { name: 'Internal', message: 'Internal error' }
    })
    expect(storageKeys).not.toHaveBeenCalled()
  })

  it('ignores a caller-supplied appId', async () => {
    resolveAppIdBySender.mockReturnValue('com.example.real')
    const info = expectOk(
      await handleBridgeRequest(1, { method: 'app.getInfo', appId: 'com.example.spoofed' }, noopEmit)
    ) as { appId: string }

    expect(info.appId).toBe('com.example.real')
  })

  it('rejects an unknown method', async () => {
    resolveAppIdBySender.mockReturnValue('com.example.real')
    await expect(handleBridgeRequest(1, { method: 'fs.readAll' }, noopEmit)).resolves.toMatchObject({
      ok: false,
      error: { name: 'InvalidArgument' }
    })
  })

  it('refuses a prototype-chain name as an unknown method, not a permission failure', async () => {
    // `ROUTES['constructor']` resolves up the prototype chain; the gate refusing it
    // would be luck. The name must be `InvalidArgument`, and the gate must never run.
    resolveAppIdBySender.mockReturnValue('com.example.real')
    assertMethodAllowed.mockClear()

    await expect(handleBridgeRequest(1, { method: 'constructor' }, noopEmit)).resolves.toMatchObject({
      ok: false,
      error: { name: 'InvalidArgument', message: 'Unknown method: constructor' }
    })
    expect(assertMethodAllowed).not.toHaveBeenCalled()
  })

  it('admits every call through the quiescing gate', async () => {
    resolveAppIdBySender.mockReturnValue('com.example.real')

    await handleBridgeRequest(1, { method: 'storage.set', params: { key: 'k', value: 'v' } }, noopEmit)

    expect(beginCapabilityCall).toHaveBeenCalledWith('com.example.real')
  })

  it('does not admit a call for an app that is quiescing', async () => {
    // Admission is the runtime's call, not the bridge's — the bridge must let the
    // refusal through rather than catching it into a generic failure.
    resolveAppIdBySender.mockReturnValue('com.example.real')
    beginCapabilityCall.mockImplementationOnce(() => {
      throw new MiniAppQuiescingError('com.example.real')
    })

    await expect(handleBridgeRequest(1, { method: 'storage.keys' }, noopEmit)).resolves.toMatchObject({
      ok: false,
      error: { name: 'Unavailable' }
    })
    expect(storageKeys).not.toHaveBeenCalled()
  })

  it('maps a network timeout to Unavailable, not Internal', () => {
    // On `publicErrorOf` directly: its default branch is `Internal`, so an UNMAPPED error
    // class is invisible — nothing throws, the name is just quietly wrong.
    expect(publicErrorOf(new MiniAppUnavailableError('timed out'))).toMatchObject({ name: 'Unavailable' })
  })

  it('maps a rate limit to RateLimited, not to the capacity name', async () => {
    // `RateLimitedError` extends `QuotaExceededError`, so an `instanceof` chain in the
    // wrong order calls every rate limit a capacity problem. Ordering IS this case.
    resolveAppIdBySender.mockReturnValue('com.example.real')
    storageSet.mockImplementationOnce(() => {
      throw new RateLimitedError('write rate exceeded')
    })

    await expect(
      handleBridgeRequest(1, { method: 'storage.set', params: { key: 'k', value: 'v' } }, noopEmit)
    ).resolves.toMatchObject({ ok: false, error: { name: 'RateLimited', message: 'write rate exceeded' } })
  })

  it('does not leak an unmapped error to the guest', async () => {
    // Host bug text carries stacks and absolute paths; the guest is untrusted code.
    resolveAppIdBySender.mockReturnValue('com.example.real')
    storageSet.mockImplementationOnce(() => {
      throw new Error('ENOENT: /Users/alice/.ssh/id_rsa')
    })

    await expect(
      handleBridgeRequest(1, { method: 'storage.set', params: { key: 'k', value: 'v' } }, noopEmit)
    ).resolves.toMatchObject({ ok: false, error: { name: 'Internal', message: 'Internal error' } })
  })

  it('hands the guest webContents id to the streaming capability', async () => {
    // The bug this guards: `ai.chat` binds its stream to the guest, so a route that
    // drops `senderId` produces a stream the runtime can never abort.
    resolveAppIdBySender.mockReturnValue('com.example.real')

    await handleBridgeRequest(77, { method: 'ai.chat', params: { messages: [] } }, noopEmit)

    expect(aiChat).toHaveBeenCalledWith('com.example.real', { messages: [] }, noopEmit, 77, undefined)
  })

  it('refuses a malformed payload', async () => {
    resolveAppIdBySender.mockReturnValue('com.example.real')

    // A `ZodError` from `RequestSchema.parse`, mapped — not rethrown.
    await expect(handleBridgeRequest(1, 'not-an-object', noopEmit)).resolves.toMatchObject({
      ok: false,
      error: { name: 'InvalidArgument' }
    })
  })

  it('checks the grant before dispatching a gated method', async () => {
    resolveAppIdBySender.mockReturnValue('com.example.real')
    assertMethodAllowed.mockClear()

    await handleBridgeRequest(1, { method: 'storage.set', params: { key: 'k', value: 'v' } }, noopEmit)

    expect(assertMethodAllowed).toHaveBeenCalledWith('com.example.real', 'storage.set')
    expect(storageSet).toHaveBeenCalled()
  })

  it('does not dispatch when the grant check refuses', async () => {
    resolveAppIdBySender.mockReturnValue('com.example.real')
    storageSet.mockClear()
    assertMethodAllowed.mockImplementationOnce(() => {
      throw new PermissionDeniedError('storage.set is not granted')
    })

    // The name matters as much as the refusal: an app that cannot tell
    // `PermissionDenied` from `Internal` cannot prompt the user to grant anything.
    await expect(
      handleBridgeRequest(1, { method: 'storage.set', params: { key: 'k', value: 'v' } }, noopEmit)
    ).resolves.toMatchObject({ ok: false, error: { name: 'PermissionDenied' } })
    expect(storageSet).not.toHaveBeenCalled()
  })

  it('leaves ungated environment methods reachable without a grant', async () => {
    resolveAppIdBySender.mockReturnValue('com.example.real')
    assertMethodAllowed.mockClear()

    const info = expectOk(await handleBridgeRequest(1, { method: 'app.getInfo' }, noopEmit))

    // `app.getInfo` is `gate: 'none'` — the gate function still runs, and returns.
    expect(assertMethodAllowed).toHaveBeenCalledWith('com.example.real', 'app.getInfo')
    // NO `theme` — §6.4 dropped it (the guest uses `matchMedia`). The mini app's own
    // version is distinct from the host's, and `application.getVersion()` does not exist.
    expect(info).toMatchObject({ appId: 'com.example.real', locale: 'zh-CN', version: '1.0.0' })
    expect(info).toHaveProperty('hostVersion')
    expect(info).not.toHaveProperty('theme')
  })
})
