import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { miniAppInstallationTable, miniAppTable } from '@data/db/schemas/miniApp'
import { modelService } from '@data/services/ModelService'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
import { MINI_APP_MAX_INPUT_BYTES, MINI_APP_MAX_MESSAGES } from '@shared/types/miniAppManifest'

import { MiniAppUnavailableError } from '../../errors'
import { resetHiddenBudgets } from '../quota'

// `vi.mocked(x)` is a TYPE cast and replaces nothing: without this `vi.mock` the real
// `getByKey` runs and `.mockReturnValue(...)` throws. `vi.mock` also hoists it.
vi.mock('@data/services/ModelService', () => ({ modelService: { getByKey: vi.fn() } }))

// `streamPrompt` is SYNCHRONOUS — the manager drives the stream by calling the
// listener afterwards, so these tests drive it the same way.
const streamPrompt = vi.fn()
const abort = vi.fn()
// Indexed, NOT "the most recent call": with several in flight, driving the last one N
// times resolves one listener N times and hangs the rest.
const callAt = (i = -1) => streamPrompt.mock.calls.at(i)![0]
const drive = {
  chunk: (text: string, i?: number) => callAt(i).listener.onChunk({ type: 'text-delta', delta: text }),
  other: (type: string, i?: number) => callAt(i).listener.onChunk({ type }),
  done: (i?: number) => callAt(i).listener.onDone({ status: 'success' }),
  // A plain `SerializedError`, which is what the manager actually delivers — never an
  // `Error`. Typing this parameter as `Error` is what kept the mapping bug invisible.
  error: (error: { name: string; message: string; stack: null }, i?: number) =>
    callAt(i).listener.onError({ status: 'error', error })
}

const lastCall = () => callAt()

// What the REAL manager does that `drive` does not: a listener whose `isAlive()` is false
// is dropped BEFORE dispatch (`AiStreamManager.dispatchToListeners`), terminal events included.
const managerLike = {
  paused: (i?: number) => {
    const listener = callAt(i).listener
    if (listener.isAlive()) listener.onPaused({ status: 'paused' })
  }
}

const guests = new Set<number>([7])
/** Guests are visible unless a test says otherwise — the pool mounts a pane to show it. */
const visibility = { visible: new Map<number, boolean>() }
const streamsOfGuest = new Map<number, string[]>()
import { mockMiniAppApplication } from '../../__tests__/applicationMock'

vi.mock('@application', () =>
  mockMiniAppApplication({
    AiStreamManager: { streamPrompt, abort },
    MiniAppRuntimeService: {
      displayNameOf: (id: string) => id,
      isGuestAlive: (id: number) => guests.has(id),
      isGuestVisible: (id: number) => visibility.visible.get(id) ?? true,
      rememberStream: (id: number, s: string) => streamsOfGuest.set(id, [...(streamsOfGuest.get(id) ?? []), s]),
      forgetStream: (id: number, s: string) =>
        streamsOfGuest.set(
          id,
          (streamsOfGuest.get(id) ?? []).filter((x) => x !== s)
        )
    }
  })
)

const { aiCapability, MINI_APP_MAX_CONCURRENT_CALLS, resetBurstForTest } = await import('../ai')
const { QuotaExceededError } = await import('../quota')
// After the mock, like everything above: a static import would hoist past the factory's consts.
const { application } = await import('@application')
// The mapping is the guest-facing half of this contract: rehydrating only matters if it
// changes what `publicErrorOf` produces.
const { publicErrorOf } = await import('../../runtime/bridge')

const A = 'com.example.a'
const GUEST = 7
const HI = { messages: [{ role: 'user' as const, content: 'hi' }] }
const chat = (
  appId = A,
  params: unknown = HI,
  emit: (c: string) => void = () => {},
  guest = GUEST,
  callId: string | undefined = undefined
) => aiCapability.chat(appId, params, emit, guest, callId)

// A real DB, not a stub: `insertApp` below writes the app and installation rows that
// `resolveModelFor` reads. Nothing here reads the usage ledger.
const dbh = setupTestDatabase()
const MODEL_ID = 'openai::gpt-4o-mini'

/**
 * A row in `mini_app` AND the installation row that carries `aiModelId`. Without the
 * second one `resolveModelFor` finds nothing (the unified Preference mock defaults
 * `chat.default_model_id` to null) and throws — so EVERY success path in this file
 * would fail before reaching `streamPrompt`, for a reason unrelated to what it tests.
 */
const insertApp = (appId: string) => {
  dbh.db
    .insert(miniAppTable)
    .values({
      appId,
      kind: 'app',
      presetMiniAppId: null,
      name: appId,
      url: `cherry-miniapp://${appId}/index.html`,
      status: 'enabled',
      orderKey: 'a0'
    })
    .run()
  dbh.db
    .insert(miniAppInstallationTable)
    .values({
      appId,
      version: '1.0.0',
      contentHash: 'sha256:x',
      source: 'file',
      manifestJson: {
        id: appId,
        name: { en: appId },
        description: { en: 'A tiny sample game.' },
        version: '1.0.0',
        entry: 'index.html',
        permissions: ['ai.chat'],
        optionalPermissions: [],
        network: []
      },
      aiModelId: MODEL_ID
    })
    .run()
}

beforeEach(() => {
  resetBurstForTest()
  // Module singletons: without this a budget case leaves its spend for whatever runs next.
  resetHiddenBudgets(GUEST)
  visibility.visible.clear()
  streamPrompt.mockReset()
  abort.mockReset()
  // REAL members of `MODEL_CAPABILITY`, not invented ones: `capabilities` is a zod
  // enum, so a made-up string describes a model the app can never be given.
  vi.mocked(modelService.getByKey).mockReturnValue({
    id: 'gpt-4o-mini',
    providerId: 'openai',
    name: 'GPT-4o mini',
    capabilities: [MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.IMAGE_RECOGNITION],
    contextWindow: 128000
  } as never)
  guests.clear()
  guests.add(GUEST)
  streamsOfGuest.clear()
  insertApp(A)
  insertApp('com.example.b')
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('cherry.ai.chat — input contract', () => {
  it('tells the app a model is missing instead of reporting a host bug', async () => {
    // The bug this guards: a bare Error falls through `publicErrorOf` to `Internal`,
    // whose message is frozen at 'Internal error'. An app cannot then tell "you have no
    // model configured" — actionable, and the common state for a fresh install — from
    // "the host is broken", so it cannot point the user at their own settings.
    dbh.db.update(miniAppInstallationTable).set({ aiModelId: null }).where(eq(miniAppInstallationTable.appId, A)).run()

    // `bridge.test.ts` pins the other half: this class reaches the guest as `Unavailable`.
    await expect(chat(A, HI)).rejects.toBeInstanceOf(MiniAppUnavailableError)
  })

  it('takes no slot at all when the model cannot be resolved', async () => {
    // The ordering `chat()` depends on: everything failable runs BEFORE `admit()`.
    // The leak is only visible on the NEXT call, never on a `rejects.toThrow()`.
    dbh.db.update(miniAppInstallationTable).set({ aiModelId: null }).where(eq(miniAppInstallationTable.appId, A)).run()

    for (let i = 0; i < MINI_APP_MAX_CONCURRENT_CALLS + 1; i++) {
      await expect(chat(A, HI)).rejects.toThrow(/no default model configured/i)
    }

    dbh.db
      .update(miniAppInstallationTable)
      .set({ aiModelId: MODEL_ID })
      .where(eq(miniAppInstallationTable.appId, A))
      .run()
    const call = chat(A, HI)
    drive.done()
    await expect(call).resolves.toEqual({ ok: true })
  })

  it('releases the slot when streamPrompt itself throws', async () => {
    // `streamPrompt` can throw AFTER `admit()`, so the try/catch is the only thing
    // returning the slot. Delete it and this fails while the case above stays green.
    streamPrompt.mockImplementation(() => {
      throw new Error('provider not found')
    })
    for (let i = 0; i < MINI_APP_MAX_CONCURRENT_CALLS + 1; i++) {
      await expect(chat()).rejects.toThrow(/provider not found/)
    }
    // `mockReset`, not `mockClear`: only reset drops the implementation, and this file
    // sets neither `clearMocks` nor `restoreMocks`.
    streamPrompt.mockReset()

    const call = chat()
    drive.done()
    await expect(call).resolves.toEqual({ ok: true })
  })

  it('refuses a callId that is still in flight, and frees it once the call settles', async () => {
    const first = chat(A, HI, () => {}, GUEST, 'c1')
    await expect(chat(A, HI, () => {}, GUEST, 'c1')).rejects.toThrow(/in flight/i)

    // The first call is still cancellable — overwriting the map is precisely what
    // would have lost it, on the one capability that spends the user's money.
    await aiCapability.cancel(A, { callId: 'c1' }, GUEST)
    expect(abort).toHaveBeenCalledWith(lastCall().streamId, 'mini-app-cancelled')
    drive.done()
    await first

    // Negative control: never freeing the label also passes the rejection above.
    const reused = chat(A, HI, () => {}, GUEST, 'c1')
    drive.done()
    await expect(reused).resolves.toEqual({ ok: true })
  })

  it('stops a call the guest asked to cancel', async () => {
    // Without the id → stream map, `cancel` has nothing to name and the call runs to
    // completion on the user's money.
    const call = chat(A, HI, () => {}, GUEST, 'c1')
    await aiCapability.cancel(A, { callId: 'c1' }, GUEST)

    expect(abort).toHaveBeenCalledWith(lastCall().streamId, 'mini-app-cancelled')
    drive.done()
    await call
  })

  it("cannot cancel another guest's call with the same label", async () => {
    // The label is the app's own, so every app picks the same obvious ones. Keying on
    // it alone would let one tab stop another tab's stream by guessing.
    const call = chat(A, HI, () => {}, GUEST, 'c1')
    await aiCapability.cancel(A, { callId: 'c1' }, GUEST + 1)

    expect(abort).not.toHaveBeenCalled()
    drive.done()
    await call
  })

  it('ignores a cancel for a call that already finished', async () => {
    // The app cannot know the call settled a tick ago, and there is nothing it could
    // do about it — an error here would be noise it must then swallow.
    const call = chat(A, HI, () => {}, GUEST, 'c1')
    drive.done()
    await call

    await expect(aiCapability.cancel(A, { callId: 'c1' }, GUEST)).resolves.toEqual({ ok: true })
    expect(abort).not.toHaveBeenCalled()
  })

  it('rejects a caller-supplied model', async () => {
    await expect(chat(A, { ...HI, model: 'gpt-4' })).rejects.toThrow()
  })

  it('rejects a prompt larger than the input ceiling', async () => {
    await expect(
      chat(A, { messages: [{ role: 'user', content: 'x'.repeat(MINI_APP_MAX_INPUT_BYTES + 1) }] })
    ).rejects.toThrow()
  })

  it('measures the prompt in bytes, so multi-byte text cannot smuggle past the cap', async () => {
    // 3 bytes per CJK char: `.length` would let this through at a third of its real cost.
    const cjk = '中'.repeat(Math.floor(MINI_APP_MAX_INPUT_BYTES / 2))
    await expect(chat(A, { messages: [{ role: 'user', content: cjk }] })).rejects.toThrow()
  })

  it('rejects an emoji-heavy prompt on the same byte budget', async () => {
    const emoji = '🎮'.repeat(Math.floor(MINI_APP_MAX_INPUT_BYTES / 3))
    await expect(chat(A, { messages: [{ role: 'user', content: emoji }] })).rejects.toThrow()
  })

  it('rejects more messages than the per-call cap', async () => {
    const many = Array.from({ length: MINI_APP_MAX_MESSAGES + 1 }, () => ({ role: 'user' as const, content: '' }))
    await expect(chat(A, { messages: many })).rejects.toThrow()
  })
})

describe('cherry.ai.chat — streaming', () => {
  it('forwards text deltas to the emitter', async () => {
    const chunks: string[] = []
    const call = chat(A, HI, (c) => chunks.push(c))
    drive.chunk('he')
    drive.chunk('llo')
    drive.done()

    await call
    expect(chunks).toEqual(['he', 'llo'])
  })

  it('forwards ONLY text — reasoning and tool chunks never reach the guest', async () => {
    // The bug this guards: piping raw UIMessageChunks through. Reasoning and tool-call
    // chunks are Cherry internals the app was never granted.
    const chunks: string[] = []
    const call = chat(A, HI, (c) => chunks.push(c))
    drive.other('reasoning-delta')
    drive.other('tool-input-start')
    drive.chunk('ok')
    drive.done()

    await call
    expect(chunks).toEqual(['ok'])
  })

  it('reports an upstream failure as Unavailable, and tells the app nothing about the host', async () => {
    // `capabilities.md` files "a remote request timed out or failed" under `Unavailable`;
    // `Internal` is "anything else". Reporting a provider outage as `Internal` told the app
    // its host was broken and warn-logged every hiccup as an unexpected internal failure.
    const call = chat()
    drive.error({ name: 'AI_APICallError', message: 'silicon::Qwen/Qwen2.5-7B 401 at api.example', stack: null })

    // The message is FIXED: a provider's error body names the model, the endpoint and
    // sometimes the account, and this module withholds all three from the guest by design.
    expect(publicErrorOf(await call.catch((e: unknown) => e))).toEqual({
      name: 'Unavailable',
      message: 'The model could not complete the request'
    })
  })

  it('carries what failed to the user’s log without putting it in the app’s error', async () => {
    // The user's own panel has to separate "the provider is down" from "the app was
    // cleared" — both are `Unavailable`, and the seven public names cannot say which.
    const call = chat()
    drive.error({ name: 'AI_APICallError', message: 'silicon 401', stack: null })
    const error = await call.catch((e: unknown) => e)

    expect((error as Error).cause).toBe('AI_APICallError')
    // And it stays out of what crosses the boundary.
    expect(JSON.stringify(publicErrorOf(error))).not.toContain('AI_APICallError')
  })

  it('surfaces an aborted stream as Cancelled, not the frozen Internal', async () => {
    // `capabilities.md` promises `Cancelled` "when the abort surfaces as an error". The
    // manager reports a PLAIN `SerializedError` and every `publicErrorOf` branch tests
    // `instanceof`, so without rehydration this — and every other upstream failure with
    // it — reached the guest as `{ name: 'Internal', message: 'Internal error' }`.
    const call = chat()
    drive.error({ name: 'AbortError', message: 'aborted', stack: null })

    expect(publicErrorOf(await call.catch((e: unknown) => e))).toEqual({ name: 'Cancelled', message: 'Cancelled' })
  })

  it('sets no output cap — the model limit is the ceiling', async () => {
    const call = chat()
    expect(lastCall().callOverrides).toBeUndefined()
    expect(lastCall().contextOwner).toBe('caller')
    drive.done()
    await call
  })

  it('never retries or falls back — the fallback path bills nothing', async () => {
    // `buildFallbackModels` resolves its model without the usage plugin: real money,
    // no ledger row, and "exactly one row per finished call" quietly becomes false.
    const call = chat()
    expect(lastCall().maxRetries).toBe(0)
    drive.done()
    await call
  })
})

describe('cherry.ai.chat — attribution', () => {
  it('attributes the call to the mini app so the usage page can show it', async () => {
    // Why Task 4A exists: without `source` the row lands anonymous — metered, but
    // impossible to attribute to an app, which is this capability's whole promise.
    const call = chat()
    expect(lastCall().source).toEqual({ type: 'mini-app', id: A, name: expect.any(String), icon: null })
    drive.done()
    await call
  })
})

describe('cherry.ai.chat — concurrency and liveness', () => {
  it('refuses more than the concurrent-call ceiling', async () => {
    const open = Array.from({ length: MINI_APP_MAX_CONCURRENT_CALLS }, () => chat())
    await expect(chat()).rejects.toBeInstanceOf(QuotaExceededError)

    // Each by its own index — the refused call never reached `streamPrompt`, so the
    // admitted ones are exactly calls 0..N-1.
    open.forEach((_, i) => drive.done(i))
    await Promise.all(open)
  })

  it('releases the concurrency slot when the stream errors', async () => {
    // The bug this guards: releasing only on the success path. A few failed calls
    // would then wedge the app out of AI for the rest of the session.
    for (let i = 0; i < MINI_APP_MAX_CONCURRENT_CALLS; i++) {
      const call = chat()
      drive.error({ name: 'Error', message: 'nope', stack: null })
      await expect(call).rejects.toThrow()
    }
    const call = chat()
    expect(streamPrompt).toHaveBeenCalledTimes(MINI_APP_MAX_CONCURRENT_CALLS + 1)
    drive.done()
    await call
  })

  it('admits exactly 60 calls a minute, then admits again once the window has passed', async () => {
    // Both edges: a cutoff of 1 also "trips before 200", and a window that never resets
    // takes the app's AI away for the rest of the session after its first minute.
    const oneCall = async () => {
      const call = chat()
      drive.done()
      await call
    }
    for (let i = 0; i < 60; i++) await oneCall()
    await expect(chat()).rejects.toThrow(/60 calls per minute/)

    vi.advanceTimersByTime(60_000)
    await expect(oneCall()).resolves.toBeUndefined()
  })

  it('ties the stream to the guest, so a dead guest stops receiving', async () => {
    // The principle (design §2.1): in-flight work dies with the app, and nothing
    // notifies it. `isAlive` is how the stream manager learns that. This drives
    // `onDone` by hand; what happens when NO callback arrives is the case below.
    const call = chat()
    expect(lastCall().listener.isAlive()).toBe(true)

    guests.delete(GUEST)
    expect(lastCall().listener.isAlive()).toBe(false)

    drive.done()
    await call
  })

  it('settles the calls of a guest that died mid-stream, so its slots come back', async () => {
    // Negative control for the case above: the real manager never calls a dead listener
    // back, so only the runtime's guest hook (`forgetGuest`) can release the slot. Two
    // deaths would otherwise wedge the app out of AI for the rest of the session.
    const dieMidStream = (guest: number, i: number) => {
      guests.delete(guest)
      aiCapability.forgetGuest(guest)
      managerLike.paused(i)
    }
    guests.add(GUEST + 1)
    const dead = [chat(A, HI, () => {}, GUEST, 'c1'), chat(A, HI, () => {}, GUEST + 1)]
    dieMidStream(GUEST, 0)
    dieMidStream(GUEST + 1, 1)

    await expect(Promise.all(dead)).resolves.toEqual([{ ok: true }, { ok: true }])
    expect(streamsOfGuest.get(GUEST)).toHaveLength(0)
    expect(streamsOfGuest.get(GUEST + 1)).toHaveLength(0)
    // The label is freed too — a cancel for it names nothing.
    await aiCapability.cancel(A, { callId: 'c1' }, GUEST)
    expect(abort).not.toHaveBeenCalled()

    guests.add(GUEST + 2)
    const next = chat(A, HI, () => {}, GUEST + 2)
    expect(streamPrompt).toHaveBeenCalledTimes(MINI_APP_MAX_CONCURRENT_CALLS + 1)
    drive.done()
    await expect(next).resolves.toEqual({ ok: true })
  })

  it('registers the stream so the runtime can abort it when the guest dies', async () => {
    // `isAlive` alone is not enough: the manager self-aborts a listener-less stream
    // only when `backgroundMode === 'abort'`, which is a user preference.
    const call = chat()
    expect(streamsOfGuest.get(GUEST)).toHaveLength(1)

    drive.done()
    await call
    expect(streamsOfGuest.get(GUEST)).toHaveLength(0)
  })
})

describe('cherry.ai.chat — reasoning', () => {
  it('asks for no thinking unless the app turns reasoning on', async () => {
    // `off` is the default: the knob is `reasoningEffort: 'none'`, and `on` must send
    // NOTHING rather than a specific effort the model may not know.
    let call = chat(A, HI)
    expect(lastCall().reasoningEffort).toBe('none')
    drive.done()
    await call

    call = chat(A, { ...HI, reasoning: 'on' })
    expect(lastCall()).not.toHaveProperty('reasoningEffort')
    drive.done()
    await call
  })

  it('rejects a value that is neither on nor off', async () => {
    await expect(chat(A, { ...HI, reasoning: 'low' })).rejects.toThrow()
    expect(streamPrompt).not.toHaveBeenCalled()
  })
})

describe('cherry.ai.chat — model slots', () => {
  const QUICK_ID = 'openai::gpt-4.1-nano'
  const setSlots = (aiModelId: string | null, aiQuickModelId: string | null) =>
    dbh.db
      .update(miniAppInstallationTable)
      .set({ aiModelId, aiQuickModelId })
      .where(eq(miniAppInstallationTable.appId, A))
      .run()
  const preferences = () => application.get('PreferenceService')

  afterEach(async () => {
    await preferences().set('chat.default_model_id', null)
    await preferences().set('feature.quick_assistant.model_id', null)
  })

  it('runs `model: "quick"` on the app quick slot, and the default slot when `model` is omitted', async () => {
    setSlots(MODEL_ID, QUICK_ID)

    let call = chat(A, { ...HI, model: 'quick' })
    expect(lastCall().uniqueModelId).toBe(QUICK_ID)
    drive.done()
    await call

    call = chat(A, HI)
    expect(lastCall().uniqueModelId).toBe(MODEL_ID)
    drive.done()
    await call
  })

  it('falls back from the app quick slot to the global quick model, then to the global default', async () => {
    // The same cascade the user sees in Settings: the quick model follows the default
    // model when unset, so an app never fails on `quick` while `default` would work.
    setSlots(null, null)
    await preferences().set('chat.default_model_id', 'openai::gpt-4o')
    await preferences().set('feature.quick_assistant.model_id', 'openai::gpt-4o-mini')

    let call = chat(A, { ...HI, model: 'quick' })
    expect(lastCall().uniqueModelId).toBe('openai::gpt-4o-mini')
    drive.done()
    await call

    await preferences().set('feature.quick_assistant.model_id', null)
    call = chat(A, { ...HI, model: 'quick' })
    expect(lastCall().uniqueModelId).toBe('openai::gpt-4o')
    drive.done()
    await call
  })

  it('rejects a slot it does not know rather than silently using the default', async () => {
    await expect(chat(A, { ...HI, model: 'cheap' })).rejects.toThrow()
    expect(streamPrompt).not.toHaveBeenCalled()
  })

  it('describes the quick slot when `getCapabilities` asks for it', async () => {
    setSlots(MODEL_ID, 'anthropic::claude-x')
    // Two different answers for the two slots — only the lookup key tells them apart.
    vi.mocked(modelService.getByKey).mockImplementation(
      (_providerId: string, modelId: string) =>
        ({
          id: modelId,
          providerId: 'x',
          name: modelId,
          capabilities: modelId === 'claude-x' ? [MODEL_CAPABILITY.REASONING] : [],
          contextWindow: modelId === 'claude-x' ? 200000 : 128000
        }) as never
    )

    expect(await aiCapability.getCapabilities(A, { model: 'quick' })).toEqual({
      available: true,
      reasoning: true,
      contextWindow: 200000
    })
    expect(await aiCapability.getCapabilities(A)).toEqual({ available: true, reasoning: false, contextWindow: 128000 })
  })
})

describe('cherry.ai.getCapabilities', () => {
  it.each([
    [[MODEL_CAPABILITY.REASONING], true],
    [[MODEL_CAPABILITY.FUNCTION_CALL], false]
  ])('derives reasoning from the resolved model (%j)', async (capabilities, expected) => {
    // Both directions, because a hardcoded constant satisfies either one on its own.
    vi.mocked(modelService.getByKey).mockReturnValue({
      id: 'gpt-4o-mini',
      providerId: 'openai',
      name: 'GPT-4o mini',
      capabilities,
      contextWindow: 128000
    } as never)

    expect(await aiCapability.getCapabilities(A)).toEqual({
      available: true,
      reasoning: expected,
      contextWindow: 128000
    })
  })

  it('reports no capability the caller cannot act on', async () => {
    // `vision` and `tools` were reported for two rounds while there was no image input
    // and no tool loop — a query surface that invites a branch which never runs.
    expect(await aiCapability.getCapabilities(A)).not.toHaveProperty('vision')
    expect(await aiCapability.getCapabilities(A)).not.toHaveProperty('tools')
  })

  it('does not reveal which model the user picked', async () => {
    const caps = await aiCapability.getCapabilities(A)

    expect(JSON.stringify(caps)).not.toMatch(/gpt|openai|claude|provider/i)
  })

  it('reports an unusable slot as a value while `chat` still rejects on it', async () => {
    // The whole point of the shape: an app hides its AI feature by reading `available`,
    // rather than learning the same fact from a rejection thrown by the method that exists
    // to prevent crashes. `chat` must NOT follow — a call that cannot run has no value.
    dbh.db.update(miniAppInstallationTable).set({ aiModelId: null }).where(eq(miniAppInstallationTable.appId, A)).run()

    await expect(aiCapability.getCapabilities(A)).resolves.toEqual({ available: false })
    await expect(chat(A, HI)).rejects.toBeInstanceOf(MiniAppUnavailableError)
  })

  it('reports a deleted model the same way, not only an empty slot', async () => {
    // Reached through a DIFFERENT throw — `getByKey`, not `resolveModelFor` — so the empty
    // slot resolving is no evidence that this one does.
    vi.mocked(modelService.getByKey).mockImplementation(() => {
      throw new Error('Model openai/gpt-4o-mini not found')
    })

    await expect(aiCapability.getCapabilities(A)).resolves.toEqual({ available: false })
  })

  it('still rejects a slot the app invented', async () => {
    // The one case that must not soften into `available: false`: answering a typo with a
    // plausible value sends the author auditing the user's settings instead of their code.
    await expect(aiCapability.getCapabilities(A, { model: 'cheap' })).rejects.toThrow()
  })
})

describe('cherry.ai.chat — background budget', () => {
  const runOne = async () => {
    const call = chat()
    drive.done()
    return call
  }

  it('cuts a hidden guest off after its allowance', async () => {
    // The reason this is a budget and not a slower rate: `ai.chat` spends the user's money,
    // there is deliberately no daily cap (the ledger cannot support one — see ai.ts), and a
    // pooled tab keeps running unthrottled while it is TOLD nobody is watching.
    visibility.visible.set(GUEST, false)
    for (let i = 0; i < 5; i++) await runOne()

    await expect(chat()).rejects.toThrow(/background budget exhausted/)
  })

  it('never touches a call already in flight', async () => {
    // Admission only. A user switching tabs mid-answer must not lose the answer, or every
    // app has to defend against its own state being torn in half.
    visibility.visible.set(GUEST, false)
    for (let i = 0; i < 4; i++) await runOne()
    const inFlight = chat()

    await expect(chat()).rejects.toThrow(/background budget exhausted/)

    // The LAST streamPrompt call, which is the in-flight one: the refused call never
    // reached the manager, so index 0 is the first already-settled warm-up instead.
    drive.done()
    await expect(inFlight).resolves.toBeDefined()
  })

  it('spends nothing while the guest is visible', async () => {
    // Counting visible calls would cut an app off seconds after it is hidden, purely for
    // having been used — the allowance is about the unwatched stretch, not about the app.
    for (let i = 0; i < 10; i++) await runOne()

    visibility.visible.set(GUEST, false)
    for (let i = 0; i < 5; i++) await expect(runOne()).resolves.toBeDefined()
  })
})
