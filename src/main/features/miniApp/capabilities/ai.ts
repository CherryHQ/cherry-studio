/**
 * `cherry.ai` — the only capability whose marginal cost is the user's money.
 *
 * No model is nameable from app code: an app picks a SLOT — `default` or `quick`,
 * the same two Cherry itself keeps — and the user fills each slot in the app's own
 * settings, falling back to the global model of the same name. `getCapabilities`
 * exists so a mini app can degrade instead of crashing when the user swaps the model
 * underneath it — without ever learning which model it is.
 */

import { application } from '@application'
import { miniAppInstallationTable } from '@data/db/schemas/miniApp'
import { modelService } from '@data/services/ModelService'
import { loggerService } from '@logger'
import type { CherryUIMessage } from '@shared/data/types/message'
import { parseUniqueModelId, type UniqueModelId, UniqueModelIdSchema } from '@shared/data/types/model'
import type { SerializedError } from '@shared/types/error'
import { MINI_APP_MAX_INPUT_BYTES, MINI_APP_MAX_MESSAGES } from '@shared/types/miniAppManifest'
import { isReasoningModel } from '@shared/utils/model'
import { eq } from 'drizzle-orm'
import * as z from 'zod'

import { InvalidArgumentError, MiniAppUnavailableError } from '../errors'
import { aiHiddenBudget, RateLimitedError } from './quota'

/**
 * Concurrency and burst are the ONLY things bounding how fast an app can spend.
 *
 * There is no daily budget. Enforcing one needs the ledger to record every call
 * reliably, and it does not: `billingHook` writes a row only when the stream reaches
 * `finish`, so a cancelled call leaves nothing. That stays unchanged — a deliberate
 * decision (design 6.1). A cutoff any app can read back to zero with `chat` + `cancel`
 * is worse than none: it promises a ceiling that is not there.
 *
 * What IS guaranteed: every call reaching `finish` lands exactly one row carrying
 * `source.type === 'mini-app'`, so the user can see what each app spent. `maxRetries: 0`
 * is what makes "exactly one" true — the cross-model fallback path has no billing
 * middleware at all, so its spend would be invisible.
 */
export const MINI_APP_MAX_CONCURRENT_CALLS = 2
const BURST_WINDOW_MS = 60_000
const BURST_MAX_CALLS = 60

const logger = loggerService.withContext('miniAppAiCapability')

const CancelParams = z.object({ callId: z.string().max(64) })

type ModelSlot = 'default' | 'quick'
const ModelSlotSchema = z.enum(['default', 'quick'])
const CapabilitiesParams = z.strictObject({ model: ModelSlotSchema.optional() }).optional()

/** Annotated rather than inferred: without it the union widens to one `available: boolean`. */
type SlotCapabilities = { available: false } | { available: true; reasoning: boolean; contextWindow: number | null }

const ChatParams = z
  .strictObject({
    messages: z
      .array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string() }))
      .min(1)
      // Bounded COUNT as well as content: ten thousand empty messages pass the byte
      // check yet still cost real framing tokens once serialized.
      .max(MINI_APP_MAX_MESSAGES),
    // Off unless asked: a mini app's call is short and metered, and thinking is the expensive default.
    reasoning: z.enum(['on', 'off']).default('off'),
    model: ModelSlotSchema.optional()
  })
  // An abuse stop on the prompt; the output is the model's own to bound. Bytes, not
  // `.length` — a CJK character can cost three times what its length says.
  .refine(
    (p) => p.messages.reduce((n, m) => n + Buffer.byteLength(m.content, 'utf8'), 0) <= MINI_APP_MAX_INPUT_BYTES,
    `Prompt exceeds the ${MINI_APP_MAX_INPUT_BYTES}-byte limit for mini apps`
  )

/**
 * Both maps are process-local ON PURPOSE.
 *
 * They bound the rate at which one app can hit the provider right now; "right now"
 * does not survive a restart and does not need to. Nothing persistent is counted
 * here — there is no budget to keep (see the header).
 */
const inflight = new Map<string, number>()
const burst = new Map<string, { start: number; calls: number }>()
/** `${guestId}:${callId}` → streamId, for `ai.cancel`. Emptied by `settle`. */
const cancellable = new Map<string, string>()
/** streamId → how to settle it without the manager, for `forgetGuest`. Emptied by `settle`. */
const abandonable = new Map<string, { guestId: number; abandon: () => void }>()
let streamSeq = 0

/** Test seam only. */
export function resetBurstForTest(): void {
  abandonable.clear()
  cancellable.clear()
  inflight.clear()
  burst.clear()
}

/**
 * Gate one call and return its release.
 *
 * Two cutoffs, both Map lookups: the burst window, then the in-flight count. There is
 * no spend check — the ledger is written for display, not for enforcement.
 */
function admit(appId: string): () => void {
  const now = Date.now()

  const b = burst.get(appId)
  if (!b || now - b.start >= BURST_WINDOW_MS) {
    burst.set(appId, { start: now, calls: 1 })
  } else if (b.calls >= BURST_MAX_CALLS) {
    throw new RateLimitedError(`AI burst cutoff: more than ${BURST_MAX_CALLS} calls per minute`)
  } else {
    b.calls += 1
  }

  if ((inflight.get(appId) ?? 0) >= MINI_APP_MAX_CONCURRENT_CALLS) {
    throw new RateLimitedError(`AI concurrency cutoff: more than ${MINI_APP_MAX_CONCURRENT_CALLS} calls in flight`)
  }

  inflight.set(appId, (inflight.get(appId) ?? 0) + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    inflight.set(appId, Math.max(0, (inflight.get(appId) ?? 1) - 1))
  }
}

/**
 * A mini app sends `{ role, content }`; `streamPrompt` wants AI-SDK `UIMessage`s.
 * Text-only on purpose — the bridge has no way to hand over an attachment, and a part
 * type the app cannot produce is a shape nobody can test.
 */
function toCherryUIMessage(m: { role: 'user' | 'assistant' | 'system'; content: string }, i: number): CherryUIMessage {
  return { id: `miniapp-${i}`, role: m.role, parts: [{ type: 'text', text: m.content }] }
}

/**
 * The app's own slot first, then the global slot of the same name; `quick` ends on
 * the default model the way Cherry's own quick model does (`useDefaultModel`). Throws
 * `Unavailable` when nothing is set — NOT the default `Internal`, whose message is
 * frozen at 'Internal error': "no model configured" is the ordinary state of a fresh
 * install and the app is the only surface that can point the user at their settings.
 */
function resolveModelFor(appId: string, slot: ModelSlot): UniqueModelId {
  const [row] = application
    .get('DbService')
    .getDb()
    .select({ aiModelId: miniAppInstallationTable.aiModelId, aiQuickModelId: miniAppInstallationTable.aiQuickModelId })
    .from(miniAppInstallationTable)
    .where(eq(miniAppInstallationTable.appId, appId))
    .all()
  const preferences = application.get('PreferenceService')
  const id =
    slot === 'quick'
      ? (row?.aiQuickModelId ??
        preferences.get('feature.quick_assistant.model_id') ??
        preferences.get('chat.default_model_id'))
      : (row?.aiModelId ?? preferences.get('chat.default_model_id'))
  if (!id) {
    throw new MiniAppUnavailableError(`No ${slot} model configured for ${appId} and no global default is set`)
  }
  // Parsed, not cast: `UniqueModelId` is a template-literal type, and a stored value
  // that lost its separator must fail here, not halfway through a provider call.
  return UniqueModelIdSchema.parse(id)
}

/**
 * The stream manager reports failures as `SerializedError` — a plain `{ name, message,
 * stack }`, never an `Error` — while every branch of `publicErrorOf` tests `instanceof`.
 * Rejecting with it verbatim therefore hands the guest the frozen `Internal` for EVERY
 * upstream failure, the `Cancelled` that `capabilities.md` promises for an abort included,
 * and logs each one as an unexpected internal failure. Rehydrated here, at the boundary
 * the serialization happens on, so `publicErrorOf` keeps taking exactly one shape.
 *
 * Everything that is not an abort is the model host failing, which `capabilities.md` lists
 * under `Unavailable` — "a remote request timed out or failed" — not under `Internal`,
 * whose row reads "anything else". Getting that wrong told the app a provider hiccup was a
 * bug in Cherry, and warn-logged each one as an unexpected internal failure.
 *
 * The upstream MESSAGE is dropped rather than forwarded. A provider's error body names the
 * model, the endpoint and sometimes the account, and this module withholds all of that on
 * purpose — see `getCapabilities`, which exists so an app can degrade without ever learning
 * which model it is on. The name travels as `cause`, which only the user's own log reads.
 */
function rehydrate(error: SerializedError): Error {
  if (error.name === 'AbortError') {
    const aborted = new Error(error.message ?? 'The model stream failed')
    aborted.name = 'AbortError'
    return aborted
  }
  return new MiniAppUnavailableError('The model could not complete the request', { cause: error.name })
}

export const aiCapability = {
  // `async` on purpose: the first two statements throw SYNCHRONOUSLY, and such a throw
  // out of a `Promise<unknown>` method escapes every `.catch()` the bridge puts on it.
  async chat(
    appId: string,
    params: unknown,
    emit: (chunk: string) => void,
    guestId: number,
    callId: string | undefined
  ): Promise<unknown> {
    const parsed = ChatParams.parse(params)
    // Refused, never overwritten: overwriting leaves the FIRST call running with
    // nothing able to name it. Freed by `settle`, so reuse after it ends is fine.
    if (callId && cancellable.has(`${guestId}:${callId}`)) {
      throw new InvalidArgumentError(`Mini app ${appId} already has a call in flight with callId ${callId}`)
    }

    // EVERYTHING failable runs BEFORE the slot is taken: only `settle()` decrements
    // `inflight`, so a throw in between leaks a slot for the life of the process.
    const uniqueModelId = resolveModelFor(appId, parsed.model ?? 'default')
    const messages = parsed.messages.map(toCherryUIMessage)

    // BEFORE `admit`, which is where the slot becomes the caller's to release: a throw
    // after it leaks one for the life of the process. Read from the host's own visibility
    // ledger, never from anything the guest claims about itself.
    aiHiddenBudget.check(guestId, application.get('MiniAppRuntimeService').isGuestVisible(guestId))

    const release = admit(appId)
    const streamId = `miniapp:${appId}:${++streamSeq}`
    const runtime = application.get('MiniAppRuntimeService')

    return new Promise((resolve, reject) => {
      const settle = (fn: () => void) => {
        release()
        runtime.forgetStream(guestId, streamId)
        abandonable.delete(streamId)
        if (callId) cancellable.delete(`${guestId}:${callId}`)
        fn()
      }

      try {
        application.get('AiStreamManager').streamPrompt({
          streamId,
          uniqueModelId,
          messages,
          // Assistant-less caller — the same shape the API gateway uses. Without
          // `contextOwner: 'caller'` Cherry would reshape a history this app owns.
          contextOwner: 'caller',
          // No retry, no fallback: a cross-model fallback resolves its model WITHOUT the
          // usage plugin (`buildFallbackModels.ts:158`) — real money, and no ledger row.
          maxRetries: 0,
          // `off` asks for no thinking where the wire profile can switch it off; `on`
          // sends nothing and leaves the model to its own default.
          ...(parsed.reasoning === 'off' ? { reasoningEffort: 'none' as const } : {}),
          // Attribution for the shared usage ledger. Without it the row lands
          // anonymous and Settings > Usage cannot tell which app spent the money.
          source: { type: 'mini-app', id: appId, name: runtime.displayNameOf(appId), icon: null },
          listener: {
            id: streamId,
            onChunk: (chunk) => {
              if (chunk.type === 'text-delta') emit(chunk.delta || '')
            },
            onDone: () => settle(() => resolve({ ok: true })),
            onError: (r) => settle(() => reject(rehydrate(r.error))),
            onPaused: () => settle(() => resolve({ ok: true })),
            // The guest's liveness IS this stream's reason to exist: false detaches the
            // listener, and the manager aborts once the last one goes.
            isAlive: () => runtime.isGuestAlive(guestId)
          }
        })

        runtime.rememberStream(guestId, streamId)
        abandonable.set(streamId, { guestId, abandon: () => settle(() => resolve({ ok: true })) })
        // Keyed by GUEST too, so one app's tab cannot cancel another tab's call by
        // guessing a label. Dropped in `settle`, which every exit path goes through.
        if (callId) cancellable.set(`${guestId}:${callId}`, streamId)
      } catch (e) {
        // `streamPrompt` can also fail synchronously; rejecting without `settle()`
        // leaks the slot the same way. That is what the `try` is for.
        settle(() => reject(e))
      }
    })
  },

  /**
   * Stop a call this guest started. Not gated (`MINI_APP_METHODS`): cancelling is not
   * a capability, and an ungrantable stop button on a metered API is a trap.
   *
   * Silent on an unknown id — the call may have finished a tick ago, and that is not
   * an error the app can do anything about.
   */
  async cancel(_appId: string, params: unknown, guestId: number) {
    const { callId } = CancelParams.parse(params)
    const streamId = cancellable.get(`${guestId}:${callId}`)
    if (streamId) application.get('AiStreamManager').abort(streamId, 'mini-app-cancelled')
    return { ok: true }
  },

  /**
   * Settle every call a dead guest still has in flight. The manager drops a listener
   * whose `isAlive()` is false BEFORE dispatching, terminal events included — so once
   * the guest is gone no `onDone`/`onPaused` will ever free the slot or the label.
   * The runtime calls this from the one place a guest is forgotten. Resolves like a
   * cancel: the result went to nobody, and that is not an error.
   */
  forgetGuest(guestId: number): void {
    for (const [streamId, entry] of [...abandonable]) {
      if (entry.guestId !== guestId) continue
      abandonable.delete(streamId)
      entry.abandon()
    }
  },

  /**
   * No `vision`, no `tools` — both would be UNACTIONABLE information. `messages[].content`
   * is text only, and tool use needs a declare/request/execute/return loop that
   * `cherry.ai` has none of. Reporting a capability the caller cannot reach only
   * invites a branch that never works; add each field back with the feature that
   * makes it usable.
   */
  async getCapabilities(appId: string, params?: unknown): Promise<SlotCapabilities> {
    // Argument validation still THROWS: a slot the guest invented is the guest's own bug,
    // and `available: false` would hide that typo behind a perfectly plausible answer.
    const slot = CapabilitiesParams.parse(params)?.model ?? 'default'
    try {
      // Derived with the repo's own predicates, and deliberately carries no model id or
      // provider name — the app degrades without learning what the user picked.
      const { providerId, modelId } = parseUniqueModelId(resolveModelFor(appId, slot))
      const model = modelService.getByKey(providerId, modelId)
      return { available: true, reasoning: isReasoningModel(model), contextWindow: model.contextWindow ?? null }
    } catch (error) {
      // Reported as a VALUE, and for every failure alike. This method exists so an app can
      // degrade instead of crash when the user swaps the model underneath it; throwing is
      // that crash. Catching by error type would let the next new one through as a throw.
      logger.warn('Mini app asked about a model slot that cannot be described', { appId, slot, error })
      return { available: false }
    }
  }
}
