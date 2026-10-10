/**
 * Ambient globals available to a Cherry Studio mini app. Cherry Studio 2.x.
 *
 * Drop this file into your project and reference it from `tsconfig.json`
 * (`"include": ["cherry.d.ts", "src"]`) — nothing to import, `cherry` is a global.
 *
 * The method set is checked against the host's routing table in CI
 * (`src/main/features/miniApp/runtime/__tests__/apiSurface.test.ts`); parameter and
 * return shapes are documented in `capabilities.md`.
 */

declare global {
  const cherry: CherryApi

  type CherryErrorName =
    | 'PermissionDenied'
    | 'QuotaExceeded'
    | 'RateLimited'
    | 'Unavailable'
    | 'InvalidArgument'
    | 'Cancelled'
    | 'Internal'

  /** Every rejection from `cherry.*` is this exact plain object — not an `Error` instance, no stack, no host paths. */
  interface CherryError {
    name: CherryErrorName
    message: string
  }

  interface CherryApi {
    app: CherryApp
    ai: CherryAi
    storage: CherryStorage
    file: CherryFile
    notification: CherryNotification
    network: CherryNetwork
    clipboard: CherryClipboard
    /** The only inbound channel. Returns an unsubscribe function. */
    on<E extends CherryEvent>(event: E, handler: (payload: CherryEventPayload[E]) => void): () => void
  }

  type CherryEvent = 'app.visibilityChange' | 'app.localeChange'

  interface CherryEventPayload {
    /** The host hides pooled apps with `display: none`, so Page Visibility never fires — this does. */
    'app.visibilityChange': { visible: boolean }
    /** `navigator.language` does not update inside the sandbox — this does. */
    'app.localeChange': { locale: string }
  }

  /** Text only — there is no image input channel, which is why `vision` is not reported. */
  interface CherryChatParams {
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
    /** Whether a reasoning model may think first. `'off'` when omitted; ignored by models that cannot switch. */
    reasoning?: 'on' | 'off'
    /** Which of the user's two model slots answers; `'default'` when omitted. */
    model?: 'default' | 'quick'
  }

  /** Byte and item counts for one namespace, alongside the limits they are measured against. */
  interface CherryUsage {
    bytes: number
    count: number
    bytesLimit: number
    countLimit: number
  }

  interface CherryAi {
    /** Resolves when the stream ends; the text arrives through `onChunk` as plain deltas. */
    chat(params: CherryChatParams, options: { onChunk: (text: string) => void; callId?: string }): Promise<{ ok: true }>
    /** Stops a call started with `callId`. Unknown ids are ignored, not errors. */
    cancel(callId: string): Promise<{ ok: true }>
    /**
     * Describes the slot you are about to call — never the model behind it.
     *
     * An unusable slot is a VALUE, not a rejection: `available: false` means the user has
     * configured no model there (or deleted the one they had), so branch on it rather than
     * wrapping the call in a `catch`. Only a `model` you made up rejects.
     */
    getCapabilities(params?: {
      model?: 'default' | 'quick'
    }): Promise<{ available: false } | { available: true; reasoning: boolean; contextWindow: number | null }>
  }

  interface CherryStorage {
    get(key: string): Promise<{ value: string | null }>
    set(key: string, value: string): Promise<{ ok: true }>
    delete(key: string): Promise<{ ok: true }>
    keys(): Promise<{ keys: string[] }>
    usage(): Promise<CherryUsage>
  }

  interface CherryFile {
    /** `data` is base64 — the bridge carries no binary types. */
    save(name: string, data: string): Promise<{ ok: true }>
    load(name: string): Promise<{ data: string | null }>
    list(): Promise<{ names: string[] }>
    /** Idempotent: deleting a name that does not exist still resolves `ok`. */
    delete(name: string): Promise<{ ok: true }>
    usage(): Promise<CherryUsage>
    /**
     * Hands one of your files to the user through the host's save dialog; `{ saved: false }`
     * when they cancel. Only while the app is visible, one dialog at a time.
     */
    export(name: string, options?: { suggestedName?: string }): Promise<{ saved: boolean }>
  }

  interface CherryApp {
    /** No `theme`: use `matchMedia('(prefers-color-scheme: dark)')`, which also reports changes. */
    getInfo(): Promise<{ appId: string; version: string; hostVersion: string; locale: string }>
    /** Every DECLARED leaf and whether it is granted right now. Needs no permission itself. */
    getPermissions(): Promise<Record<string, boolean>>
  }

  interface CherryNotification {
    /** Over-long `title` / `body` are truncated, not rejected. */
    show(params: { title: string; body?: string }): Promise<{ ok: true }>
  }

  /** Plain text, both ways, and only while the app is visible and has keyboard focus — a background app is refused. */
  interface CherryClipboard {
    /** Whatever text is on the clipboard, clipped to 1 MB; `''` when there is none. */
    read(): Promise<{ text: string }>
    write(params: { text: string }): Promise<{ ok: true }>
  }

  interface CherryFetchParams {
    url: string
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'
    /** `Host`, `Cookie`, `Origin` and the rest of the forbidden set are REJECTED, not stripped. */
    headers?: Record<string, string>
    /** base64 — the bridge carries no binary types. */
    body?: string
  }

  interface CherryNetwork {
    /**
     * The only way out. https only, no port, no IP literal, and only hosts this app's
     * manifest declares. A non-2xx status is a RESULT, not a rejection — only unreachable,
     * over-limit and not-permitted reject.
     */
    fetch(params: CherryFetchParams): Promise<{ status: number; headers: Record<string, string>; body: string }>
  }
}

export {}
