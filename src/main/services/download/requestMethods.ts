const DEFAULT_LIMIT = 1024
// A POST export can take minutes before its attachment arrives; keep the
// method history long enough that a later GET cannot reclassify it as replayable.
const DEFAULT_TTL_MS = 10 * 60_000

interface Entry {
  methods: string[]
  at: number
}

interface PendingRequest {
  url: string
  method: string
}

/**
 * Remembers the HTTP method of recent requests in one session.
 *
 * Electron's `DownloadItem` exposes the URL but not the request method, and the
 * download manager re-issues every transfer with `session.fetch`. A POST-triggered
 * attachment cannot be replayed that way, so `will-download` needs the method
 * before it decides to cancel the original item.
 *
 * The table is bounded: a busy page can issue thousands of requests between a
 * click and the dialog, and an unbounded map would keep every URL for the life of
 * the process. In-flight requests live in a separate map that is never aged out
 * or evicted by the history limit: a long POST can outlive both, and its
 * attachment must still be recognised as non-replayable when it finally arrives.
 */
export class RequestMethods {
  private readonly entries = new Map<string, Entry>()
  /** Requests that have not completed, keyed by Electron's request id. */
  private readonly pending = new Map<number, PendingRequest>()

  constructor(
    private readonly limit = DEFAULT_LIMIT,
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly now: () => number = Date.now
  ) {}

  record(url: string, method: string | undefined, requestId?: number): void {
    if (!method) return
    const upper = method.toUpperCase()
    const now = this.now()
    if (requestId !== undefined) this.pending.set(requestId, { url, method: upper })
    const existing = this.entries.get(url)
    if (existing && now - existing.at <= this.ttlMs) {
      existing.at = now
      if (!existing.methods.includes(upper)) existing.methods.push(upper)
      return
    }
    if (this.entries.size >= this.limit) this.prune()
    this.entries.set(url, { methods: [upper], at: now })
  }

  /** A request that completed or failed can no longer deliver an attachment. */
  finish(requestId: number): void {
    this.pending.delete(requestId)
  }

  /**
   * A URL seen with more than one method cannot be attributed to the request
   * that produced a `will-download`; reporting `undefined` keeps the item with
   * Electron instead of replaying the wrong method.
   *
   * GET and HEAD are the exception: the manager replays both as GET, and its own
   * probe adds HEAD to every URL it manages. A history made only of those two
   * therefore still belongs to the manager; any other method leaves the URL
   * ambiguous, so a POST attachment stays with Electron.
   *
   * An outstanding request with a body outranks the history: the POST record may
   * have expired or been evicted while the response was still on its way, and
   * replaying that attachment as GET would drop the body.
   */
  methodFor(url: string): string | undefined {
    for (const pending of this.pending.values()) {
      if (pending.url === url && !isReplayableDownload(pending.method)) return undefined
    }
    const entry = this.entries.get(url)
    if (!entry) return undefined
    if (this.now() - entry.at > this.ttlMs) {
      this.entries.delete(url)
      return undefined
    }
    if (entry.methods.every(isReplayableDownload)) {
      return entry.methods.includes('GET') ? 'GET' : 'HEAD'
    }
    return entry.methods.length === 1 ? entry.methods[0] : undefined
  }

  private prune(): void {
    const cutoff = this.now() - this.ttlMs
    for (const [url, entry] of this.entries) {
      if (entry.at < cutoff) this.entries.delete(url)
    }
    // A burst can outrun the TTL; drop the oldest entries rather than grow.
    if (this.entries.size >= this.limit) {
      const excess = this.entries.size - Math.floor(this.limit / 2)
      let removed = 0
      for (const url of this.entries.keys()) {
        this.entries.delete(url)
        if (++removed >= excess) break
      }
    }
  }
}

/**
 * Shared by the browser partition policy (writer) and the download takeover
 * (reader). The policy owns the only `onBeforeRequest`, `onCompleted` and
 * `onErrorOccurred` listeners on those sessions, so the takeover must not
 * install its own.
 */
export const browserRequestMethods = new RequestMethods()

/**
 * Only a request without a body can be re-issued by the manager. An unobserved
 * request is treated as non-replayable: losing a download is worse than leaving
 * it to Electron's own transport.
 */
export function isReplayableDownload(method: string | undefined): boolean {
  return method === 'GET' || method === 'HEAD'
}
