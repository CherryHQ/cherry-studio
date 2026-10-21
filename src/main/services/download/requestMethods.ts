const DEFAULT_LIMIT = 1024
const DEFAULT_TTL_MS = 60_000

interface Entry {
  methods: string[]
  at: number
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
 * the process.
 */
export class RequestMethods {
  private readonly entries = new Map<string, Entry>()

  constructor(
    private readonly limit = DEFAULT_LIMIT,
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly now: () => number = Date.now
  ) {}

  record(url: string, method: string | undefined): void {
    if (!method) return
    const upper = method.toUpperCase()
    const now = this.now()
    const existing = this.entries.get(url)
    if (existing && now - existing.at <= this.ttlMs) {
      existing.at = now
      if (!existing.methods.includes(upper)) existing.methods.push(upper)
      return
    }
    if (this.entries.size >= this.limit) this.prune()
    this.entries.set(url, { methods: [upper], at: now })
  }

  /**
   * A URL seen with more than one method cannot be attributed to the request
   * that produced a `will-download`; reporting `undefined` keeps the item with
   * Electron instead of replaying the wrong method.
   */
  methodFor(url: string): string | undefined {
    const entry = this.entries.get(url)
    if (!entry) return undefined
    if (this.now() - entry.at > this.ttlMs) {
      this.entries.delete(url)
      return undefined
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
 * (reader). The policy owns the only `onBeforeRequest` listener on those
 * sessions, so the takeover must not install a second one.
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
