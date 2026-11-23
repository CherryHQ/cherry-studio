/**
 * Guest-side bridge. This file runs with Node privileges even though the guest
 * does not, so ONLY plain functions and plain data may cross `exposeInMainWorld` —
 * an object closing over a Node primitive would void the sandbox.
 */

import { contextBridge, ipcRenderer } from 'electron'

import {
  type BridgeResult,
  MINI_APP_BRIDGE_CHANNEL,
  MINI_APP_EVENT_CHANNEL,
  MINI_APP_GUEST_LIMITS,
  MINI_APP_STREAM_CHANNEL
} from '@shared/ipc/schemas/miniAppBridge'

let seq = 0
const streams = new Map<string, (chunk: string) => void>()

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Main pushes event-specific IPC payloads; this registry forwards them unchanged to guest handlers without claiming a shared domain shape.
const listeners = new Map<string, Set<(payload: unknown) => void | Promise<void>>>()

ipcRenderer.on(MINI_APP_STREAM_CHANNEL, (_e, { requestId, chunk }) => streams.get(requestId)?.(chunk))

ipcRenderer.on(MINI_APP_EVENT_CHANNEL, (_e, { event, payload }) => {
  // Fire-and-forget: no event here is awaited by main, so swallowing a rejection only
  // keeps one bad handler from taking down the others.
  for (const fn of [...(listeners.get(event) ?? [])]) {
    try {
      // Not `void`: that discards the VALUE and attaches no rejection handler. The
      // `try` still has a job — a SYNCHRONOUS throw never becomes a promise at all.
      Promise.resolve(fn(payload)).catch(() => {})
    } catch {
      // A guest handler that throws synchronously is the guest's problem, not the
      // bridge's.
    }
  }
})

/**
 * Cheap guest-side length gate, BEFORE the payload crosses the bridge.
 *
 * Main validates the same limits authoritatively — this is not the enforcement
 * point. But by the time main sees an oversized payload it has already been
 * structured-cloned out of the guest and copied into the main process, so rejecting
 * it there still pays the memory cost the limit exists to avoid. Refusing here keeps
 * the allocation inside the guest's own (sandboxed, disposable) renderer.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Untrusted guest JavaScript can bypass declared string types; coerce and bound the exact value forwarded before IPC copies it into main.
const assertPayloadSize = (value: unknown, cap: number, what: string): string => {
  // COERCED before it is measured, and the coerced string is what the caller forwards.
  // The parameter types are not a gate — the guest is untrusted JS — and an `ArrayBuffer`
  // or any plain object has `length === undefined`, so `undefined > cap` is `false` and a
  // raw length check waves through the very allocation this exists to keep out of main.
  const text = String(value ?? '')

  // `guestRefusal`, not a bare Error: an author writing `catch (e) { e.name }` must see the
  // same seven names whether the refusal came from here or from main.
  if (text.length > cap) throw guestRefusal(`Mini app ${what} exceeds the ${cap} character limit`)

  return text
}

// One gate per variable-length input — design §6.0 froze the list, and a param missing
// from here is the one param that reaches the main process unchecked.
const gateKey = (key: string) => assertPayloadSize(key, MINI_APP_GUEST_LIMITS.storageKeyChars, 'storage key')
const gateName = (name: string) => assertPayloadSize(name, MINI_APP_GUEST_LIMITS.fileNameChars, 'file name')

const gateCallId = (id?: string) =>
  id === undefined ? undefined : assertPayloadSize(id, MINI_APP_GUEST_LIMITS.callIdChars, 'callId')

/*
 * Every gate RETURNS the object that crosses the bridge, rebuilt from the fields it
 * measured. Forwarding the guest's own object would structured-clone whatever else it
 * carries into the main process in full before Zod drops it — the exact allocation
 * these gates exist to prevent. Main still validates; this only bounds.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw guest fields can be arbitrary values; convert once while preserving undefined for main's required-field validation.
const str = (value: unknown) => (value === undefined ? undefined : String(value))

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Guest chat arguments are untrusted; rebuild only bounded fields here and leave role/model/content validity to the main capability parser.
const gateChat = (params: unknown) => {
  const raw = params !== null && typeof params === 'object' ? params : {}
  const sourceMessages = 'messages' in raw ? raw.messages : undefined
  const hasMessages = Array.isArray(sourceMessages)
  const messages: Array<{ role: string | undefined; content: string | undefined }> = []

  if (hasMessages) {
    const length = sourceMessages.length

    if (!Number.isInteger(length) || length < 0 || length > MINI_APP_GUEST_LIMITS.chatMessages) {
      throw guestRefusal(`Mini app chat exceeds the ${MINI_APP_GUEST_LIMITS.chatMessages} message limit`)
    }

    messages.length = length

    for (let index = 0; index < length; index++) {
      if (!(index in sourceMessages)) continue
      const item: unknown = sourceMessages[index]
      const message = item !== null && typeof item === 'object' ? item : {}
      const role = 'role' in message ? message.role : undefined
      const content = 'content' in message ? message.content : undefined
      // Stateful conversions must produce the same string that is measured and forwarded.
      const text = str(content)
      assertPayloadSize(text ?? '', MINI_APP_GUEST_LIMITS.chatContentChars, 'chat content')

      messages[index] = { role: str(role)?.slice(0, 16), content: text }
    }
  }

  return {
    messages: hasMessages ? messages : undefined,
    reasoning: str('reasoning' in raw ? raw.reasoning : undefined)?.slice(0, 16),
    model: str('model' in raw ? raw.model : undefined)?.slice(0, 16)
  }
}

/**
 * EVERY variable-length field of `network.fetch`, not just the body.
 *
 * A 50 MB url string or a headers object with a hundred thousand keys is structured-cloned
 * into the main process in full before Zod ever sees it — which is the one thing these
 * guest-side gates exist to prevent (design §9).
 */
const gateFetch = (raw: { url?: unknown; method?: unknown; headers?: unknown; body?: unknown } | null) => {
  const params = raw ?? {}
  // Coerced once and measured on the forwarded string — see `gateChat`.
  const url = str(params.url)
  assertPayloadSize(url ?? '', MINI_APP_GUEST_LIMITS.fetchUrlChars, 'request url')
  const rawHeaders = params.headers ?? {}
  const headers =
    Object.keys(rawHeaders).length <= MINI_APP_GUEST_LIMITS.fetchHeaderCount ? Object.entries(rawHeaders) : undefined

  if (!headers || headers.length > MINI_APP_GUEST_LIMITS.fetchHeaderCount) {
    throw guestRefusal(`Mini app request exceeds the ${MINI_APP_GUEST_LIMITS.fetchHeaderCount} header limit`)
  }

  const bounded = Object.fromEntries(
    headers.map(([name, value]) => {
      assertPayloadSize(name, MINI_APP_GUEST_LIMITS.fetchHeaderNameChars, 'header name')
      const text = String(value ?? '')
      assertPayloadSize(text, MINI_APP_GUEST_LIMITS.fetchHeaderValueChars, 'header value')

      return [name, text] as const
    })
  )

  const body = str(params.body)

  if (body !== undefined) assertPayloadSize(body, MINI_APP_GUEST_LIMITS.fetchBodyChars, 'request body')

  return { url, method: str(params.method)?.slice(0, 16), headers: bounded, body }
}

/** Notifications truncate instead of throwing — the one exception, decided in §6.5. */
const clip = (value: string, cap: number) => (value.length <= cap ? value : `${value.slice(0, cap - 1)}…`)

/** Guest-side refusals use the SAME shape as main's — one error model, not two. */
const guestRefusal = (message: string) => cherryError({ name: 'InvalidArgument', message })

/**
 * The guest-side half of the error contract.
 *
 * `name` cannot cross `ipcMain.handle`: Electron serializes a thrown Error and hands the
 * renderer ONLY its `message` (`electron.d.ts:8877`). So main never throws across the
 * boundary — it returns an envelope, and the name is reconstructed here.
 *
 * A plain object, NOT an `Error`: this world is still not the mini app's. `contextBridge`
 * copies an Error across worlds and drops its custom properties (Electron docs, "Parameter /
 * Error / Return Type support"), so an Error with `name` assigned arrives in the page as a
 * bare `Error` — every one of the seven names erased a second time. A plain object is
 * structured-cloned with its keys intact, and `{ name, message }` is the documented shape.
 */
const cherryError = (error: { name: string; message: string }) => ({ name: error.name, message: error.message })

const unwrap = (result: BridgeResult) => {
  if (result.ok) return result.value
  throw cherryError(result.error)
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Bounded guest method payloads still require main's capability-specific schemas; this transport only invokes and unwraps the shared reply envelope.
const call = async (method: string, params?: unknown) =>
  unwrap(await ipcRenderer.invoke(MINI_APP_BRIDGE_CHANNEL, { method, params }))

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- gateChat bounds allocation without proving the chat schema; main validates params while this transport owns stream registration and cleanup.
const callStreaming = async (method: string, params: unknown, onChunk: (chunk: string) => void, callId?: string) => {
  const requestId = `r${++seq}`
  streams.set(requestId, onChunk)

  try {
    return unwrap(await ipcRenderer.invoke(MINI_APP_BRIDGE_CHANNEL, { method, params, requestId, callId }))
  } finally {
    streams.delete(requestId)
  }
}

/*
 * EVERY method here is `async`, `on` alone excepted.
 *
 * Not a style preference. The gates above (`gateChat`, `gateKey`, `gateName`,
 * `gateCallId`, `gateFetch`, `assertPayloadSize`) throw SYNCHRONOUSLY, and they run
 * before `call` is ever reached. In a non-async arrow that throw escapes as an
 * exception rather than a rejected promise, so `cherry.storage.set(k, v).catch(...)`
 * — which is exactly what `cherry.d.ts` tells an author to write, since every
 * signature there returns a Promise — never sees it.
 *
 * The rule is written on the whole surface rather than on the methods that happen to
 * have a gate today, because a gate added to an ungated method later is a one-line
 * change that would otherwise silently break its caller's error handling.
 */
contextBridge.exposeInMainWorld('cherry', {
  ai: {
    // The APP's own label. Attaching an id to the returned promise would depend on
    // contextBridge preserving custom properties across worlds — unverified.

    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- contextBridge exposes this directly to guest JavaScript; gateChat must bound and rebuild arbitrary arguments before main validates them.
    chat: async (params: unknown, opts?: { onChunk?: (c: string) => void; callId?: string } | null) => {
      const { onChunk, callId } = opts ?? {}

      return callStreaming('ai.chat', gateChat(params), onChunk ?? (() => {}), gateCallId(callId))
    },
    cancel: async (callId: string) => call('ai.cancel', { callId: gateCallId(callId) }),
    getCapabilities: async (params?: { model?: unknown } | null) => {
      // `?? {}`, not a default parameter or an `=== undefined` test: a default fills in for
      // `undefined` ALONE, so `cherry.ai.getCapabilities(null)` reaches the property read and
      // rejects with a native TypeError — outside the seven names `cherry.d.ts` promises.
      const { model } = params ?? {}

      return call('ai.getCapabilities', model === undefined ? undefined : { model: str(model)?.slice(0, 16) })
    }
  },
  storage: {
    get: async (key: string) => call('storage.get', { key: gateKey(key) }),
    set: async (key: string, value: string) => {
      const gated = assertPayloadSize(value, MINI_APP_GUEST_LIMITS.storageValueChars, 'storage value')

      return call('storage.set', { key: gateKey(key), value: gated })
    },
    delete: async (key: string) => call('storage.delete', { key: gateKey(key) }),
    keys: async () => call('storage.keys'),
    usage: async () => call('storage.usage')
  },
  file: {
    save: async (name: string, data: string) => {
      const gated = assertPayloadSize(data, MINI_APP_GUEST_LIMITS.fileDataChars, 'file payload')

      return call('file.save', { name: gateName(name), data: gated })
    },
    load: async (name: string) => call('file.load', { name: gateName(name) }),
    list: async () => call('file.list'),
    delete: async (name: string) => call('file.delete', { name: gateName(name) }),
    usage: async () => call('file.usage'),
    export: async (name: string, opts?: { suggestedName?: string } | null) => {
      const { suggestedName } = opts ?? {}
      const params = { name: gateName(name) }

      if (suggestedName !== undefined) Object.assign(params, { suggestedName: gateName(suggestedName) })

      return call('file.export', params)
    }
  },
  app: {
    getInfo: async () => call('app.getInfo'),
    getPermissions: async () => call('app.getPermissions')
  },
  network: {
    /** One object parameter, matching `cherry.d.ts` — NOT `fetch(url, init)`. */
    fetch: async (params?: { url?: unknown; method?: unknown; headers?: unknown; body?: unknown } | null) =>
      call('network.fetch', gateFetch(params ?? {}))
  },
  clipboard: {
    read: async () => call('clipboard.read'),
    write: async (params?: { text?: unknown } | null) => {
      // Coerced once and measured on the forwarded string — see `gateChat`.
      const text = str((params ?? {}).text)
      assertPayloadSize(text ?? '', MINI_APP_GUEST_LIMITS.clipboardTextChars, 'clipboard text')

      return call('clipboard.write', { text })
    }
  },
  notification: {
    // TRUNCATES rather than rejects, alone among these gates (§6.5); main truncates
    // again as the authority. One public behaviour per field, not one per layer.
    show: async (params?: { title?: unknown; body?: unknown } | null) => {
      const { title, body } = params ?? {}

      return call('notification.show', {
        title: clip(String(title ?? ''), MINI_APP_GUEST_LIMITS.notificationTitleChars),
        body: clip(String(body ?? ''), MINI_APP_GUEST_LIMITS.notificationBodyChars)
      })
    }
  },
  // NOT async: it returns the unsubscribe function itself, and `cherry.d.ts` types it
  // that way. An author writes `const off = cherry.on(...)`, not `await`.
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Guest handlers subscribe by event name and receive its raw main-process payload; the bridge only registers and isolates handler failures.
  on: (event: string, handler: (payload: unknown) => void | Promise<void>) => {
    const set = listeners.get(event) ?? new Set()
    set.add(handler)
    listeners.set(event, set)

    return () => set.delete(handler)
  }
})
