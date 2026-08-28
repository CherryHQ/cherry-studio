/**
 * Per-app activity log: what a mini app DID — every refusal, every call that leaves
 * the sandbox, every permission decision — and never what it said.
 *
 * Plain JSONL under the logs directory, one file per activity day, the newest
 * `ACTIVITY_DAYS_KEPT` days kept. Written with `appendFile` per line: nothing is held
 * open, so there is no handle per running app and nothing to close on quit.
 *
 * A plain singleton, not a lifecycle service: it owns no timer. `MiniAppRuntimeService`
 * decides WHEN counts flush — once a minute, when an app's last guest goes, before an
 * app is taken offline, on stop — and when a log is forgotten, because it is the one
 * place that knows those moments.
 */

import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import {
  type MiniAppActivityEntry,
  MiniAppActivityEntrySchema,
  type MiniAppActivityGrant,
  type MiniAppActivityListing
} from '@shared/types/miniAppActivity'
import type { MiniAppMethod } from '@shared/types/miniAppManifest'
import { shell } from 'electron'

import { miniAppLogsPath } from './paths'

const logger = loggerService.withContext('miniAppActivityLog')

/**
 * Activity days, not calendar days: the newest seven files survive however old they
 * are, so an app opened once a month still shows its last session.
 */
export const ACTIVITY_DAYS_KEPT = 7
/** Per app per day. Past it the day gets one `truncated` line and nothing more. */
export const ACTIVITY_DAY_BYTES = 5 * 1024 * 1024
/** The backstop for long-running apps; the runtime also flushes at the moments it knows about. */
export const ACTIVITY_COUNT_FLUSH_MS = 60_000
const FILE_PATTERN = /^activity\.(\d{4}-\d{2}-\d{2})\.log$/

/**
 * Which calls get a line of their own. The rest are counted per method and flushed as
 * one `count` line a minute: `storage.set` alone may run 20 times a second, and a log
 * that fills in minutes is a log nobody reads. A REFUSED call is always a line whatever
 * its tier — an app probing what it was not granted is the thing this exists to show.
 */
const TIER = {
  'app.getInfo': 'count',
  'app.getPermissions': 'count',
  'ai.chat': 'event',
  'ai.getCapabilities': 'count',
  'ai.cancel': 'count',
  'storage.get': 'count',
  'storage.set': 'count',
  'storage.delete': 'count',
  'storage.keys': 'count',
  'storage.usage': 'count',
  'file.save': 'count',
  'file.load': 'count',
  'file.list': 'count',
  'file.delete': 'count',
  'file.usage': 'count',
  'file.export': 'event',
  'notification.show': 'event',
  'clipboard.read': 'event',
  'clipboard.write': 'event',
  'network.fetch': 'event'
} as const satisfies Record<MiniAppMethod, 'event' | 'count'>

type Facet = Record<string, string | number | boolean>
type Params = Record<string, unknown> | undefined

const str = (value: unknown): string => (typeof value === 'string' ? value : '')
/** Decoded size of a base64 string without decoding it — the bridge carries no binary. */
function base64Bytes(value: unknown): number {
  const s = str(value)
  const padding = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((s.length * 3) / 4) - padding)
}

/** Metadata only: sizes and addresses at most. Never a key, a name, a message or a text. */
function facetOf(method: MiniAppMethod, params: Params, result: unknown): Facet | undefined {
  const out = result as Record<string, unknown> | undefined
  switch (method) {
    case 'network.fetch': {
      const facet: Facet = {}
      try {
        facet.host = new URL(str(params?.url)).hostname
      } catch {
        // An unparsable url is the refusal's own reason; nothing to attribute it to.
      }
      if (typeof out?.status === 'number') facet.status = out.status
      if (out?.body !== undefined) facet.bytes = base64Bytes(out.body)
      return facet
    }
    case 'clipboard.write':
      return { chars: str(params?.text).length }
    case 'clipboard.read':
      return out ? { chars: str(out.text).length } : undefined
    case 'file.export':
      return out ? { saved: out.saved === true } : undefined
    case 'ai.chat': {
      const messages = Array.isArray(params?.messages) ? params.messages : []
      const bytes = messages.reduce(
        (sum: number, m) => sum + Buffer.byteLength(str((m as { content?: unknown })?.content)),
        0
      )
      return { model: str(params?.model) || 'default', messages: messages.length, bytes }
    }
    default:
      return undefined
  }
}

/** What the counted tier adds up besides calls: the bytes a call moved in or out. */
function bytesOf(method: MiniAppMethod, params: Params, result: unknown): number {
  const out = result as Record<string, unknown> | undefined
  switch (method) {
    case 'storage.set':
      return Buffer.byteLength(str(params?.value))
    case 'storage.get':
      return Buffer.byteLength(str(out?.value))
    case 'file.save':
      return base64Bytes(params?.data)
    case 'file.load':
      return base64Bytes(out?.data)
    default:
      return 0
  }
}

/** `YYYY-MM-DD` in local time — the day the user would call "today". */
function localDay(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

async function dayFiles(dir: string): Promise<string[]> {
  let names: string[]
  try {
    names = await fs.promises.readdir(dir)
  } catch {
    return []
  }
  // Names sort as dates: newest first.
  return names.filter((n) => FILE_PATTERN.test(n)).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
}

interface Counter {
  calls: number
  bytes: number
}

interface DayBudget {
  day: string
  bytes: number
  truncated: boolean
}

export class MiniAppActivityLog {
  /** Per-app write serialization: appends and the sweep must not interleave. */
  private readonly chains = new Map<string, Promise<unknown>>()
  /** appId → the day its directory was last swept. Re-swept when the day rolls over. */
  private readonly swept = new Map<string, string>()
  private readonly counters = new Map<string, Map<string, Counter>>()
  private readonly budgets = new Map<string, DayBudget>()
  /**
   * appIds whose log `forget` removed, until a new installation records itself.
   *
   * Taking an app offline deliberately does NOT wait for in-flight capability calls
   * (design §2.1), so a `network.fetch` that resolves after the uninstall still reaches
   * `recordCall` — and because writes are serialized per app, its append runs AFTER the
   * delete and `mkdir`s the directory back. An uninstalled app with a live log.
   */
  private readonly forgotten = new Set<string>()

  /** Called by the bridge for EVERY call. Never throws: a logging failure is not the app's failure. */
  recordCall(
    appId: string,
    method: MiniAppMethod,
    outcome: string,
    durationMs: number,
    params: unknown,
    result: unknown,
    /** What failed underneath the public outcome — a class name, never a message. */
    reason?: string
  ): void {
    // Gated HERE as well as in `append`: the count tier returns before ever reaching it,
    // and a stale call would leave a counter for the next `flush` to write out.
    if (this.forgotten.has(appId)) return
    const p = params && typeof params === 'object' ? (params as Record<string, unknown>) : undefined
    if (TIER[method] === 'count' && outcome === 'ok') {
      const perApp = this.counters.get(appId) ?? new Map<string, Counter>()
      const counter = perApp.get(method) ?? { calls: 0, bytes: 0 }
      counter.calls += 1
      counter.bytes += bytesOf(method, p, result)
      perApp.set(method, counter)
      this.counters.set(appId, perApp)
      return
    }
    // Merged rather than passed to `facetOf`: the reason belongs to the FAILURE, and
    // `facetOf` describes the call — it has no error to look at and should not grow one.
    const called = facetOf(method, p, result)
    const facet = reason ? { ...called, reason } : called
    this.append(appId, {
      v: 1,
      ts: Date.now(),
      kind: 'call',
      name: method,
      outcome,
      durationMs,
      ...(facet ? { facet } : {})
    })
  }

  recordGrant(appId: string, entry: Omit<MiniAppActivityGrant, 'v' | 'ts' | 'kind'>): void {
    // A new installation of a forgotten id starts logging again. Keyed on the `install`
    // record rather than a separate call every install path would have to remember.
    if (entry.name === 'install') this.forgotten.delete(appId)
    this.append(appId, { v: 1, ts: Date.now(), kind: 'grant', ...entry })
  }

  /**
   * Newest first, across the kept days, plus what the whole log weighs on disk.
   * `deniedOnly` keeps calls that did not resolve `ok`.
   */
  async list(appId: string, options: { limit: number; deniedOnly: boolean }): Promise<MiniAppActivityListing> {
    const dir = miniAppLogsPath(appId)
    const files = await dayFiles(dir)
    const entries: MiniAppActivityEntry[] = []
    let bytes = 0
    for (const name of files) {
      const file = path.join(dir, name)
      // The footprint comes from the file SIZE, and no file is read once the page is full:
      // the panel calls this on every open, and the retention window can hold 35 MB.
      const size = await fs.promises.stat(file).then(
        (stat) => stat.size,
        () => null
      )
      if (size === null) continue
      bytes += size
      if (entries.length >= options.limit) continue
      let text: string
      try {
        text = await fs.promises.readFile(file, 'utf8')
      } catch {
        continue
      }
      const lines = text.split('\n')
      for (let i = lines.length - 1; i >= 0 && entries.length < options.limit; i--) {
        // A crash can leave a torn last line; it is skipped, not fatal.
        const entry = parseLine(lines[i])
        if (!entry) continue
        if (options.deniedOnly && !(entry.kind === 'call' && entry.outcome !== 'ok')) continue
        entries.push(entry)
      }
    }
    return { entries, bytes, days: files.length }
  }

  /** The user's "clear log": the whole tree, then the next line recreates it. */
  clear(appId: string): Promise<void> {
    return this.serialize(appId, async () => {
      this.counters.delete(appId)
      this.budgets.delete(appId)
      await fs.promises.rm(miniAppLogsPath(appId), { recursive: true, force: true })
    })
  }

  /** The user's "open log folder": the files are theirs to read with anything. */
  async openFolder(appId: string): Promise<void> {
    const dir = miniAppLogsPath(appId)
    await fs.promises.mkdir(dir, { recursive: true })
    const failure = await shell.openPath(dir)
    if (failure) throw new Error(failure)
  }

  /** Uninstall: the log goes with the app. Unlike `clear`, nothing may recreate it. */
  async forget(appId: string): Promise<void> {
    // BEFORE the queue, and synchronously: an in-flight call landing from here on must be
    // refused rather than race the delete below.
    this.forgotten.add(appId)
    await this.serialize(appId, async () => {
      this.counters.delete(appId)
      this.budgets.delete(appId)
      this.swept.delete(appId)
      await fs.promises.rm(miniAppLogsPath(appId), { recursive: true, force: true })
    })
  }

  private append(appId: string, entry: MiniAppActivityEntry): void {
    // Enqueue-time is enough: `forget` raises the mark synchronously, so anything queued
    // before it already runs ahead of the delete and anything after it is refused here.
    if (this.forgotten.has(appId)) return
    void this.serialize(appId, async () => {
      const dir = miniAppLogsPath(appId)
      const day = localDay(entry.ts)
      const file = path.join(dir, `activity.${day}.log`)
      await fs.promises.mkdir(dir, { recursive: true })
      // Keyed by DAY, not just by app: a host left running past the retention window would
      // otherwise keep one file per activity day until the next restart.
      if (this.swept.get(appId) !== day) {
        this.swept.set(appId, day)
        await this.sweep(dir, day)
      }
      const budget = await this.budgetFor(appId, day, file)
      if (budget.truncated) return
      const line = `${JSON.stringify(entry)}\n`
      if (budget.bytes + line.length > ACTIVITY_DAY_BYTES) {
        budget.truncated = true
        await fs.promises.appendFile(file, `${JSON.stringify({ v: 1, ts: entry.ts, kind: 'truncated' })}\n`)
        return
      }
      budget.bytes += line.length
      await fs.promises.appendFile(file, line)
    }).catch((error) => logger.warn('Could not record mini app activity', { appId, error }))
  }

  /** Keeps the newest `ACTIVITY_DAYS_KEPT` day files, counting today's — whether or not it exists yet. */
  private async sweep(dir: string, today: string): Promise<void> {
    const files = await dayFiles(dir)
    const keep = files.includes(`activity.${today}.log`) ? ACTIVITY_DAYS_KEPT : ACTIVITY_DAYS_KEPT - 1
    for (const name of files.slice(keep)) {
      await fs.promises.rm(path.join(dir, name), { force: true })
    }
  }

  private async budgetFor(appId: string, day: string, file: string): Promise<DayBudget> {
    const known = this.budgets.get(appId)
    if (known?.day === day) return known
    let bytes = 0
    try {
      bytes = (await fs.promises.stat(file)).size
    } catch {
      // No file yet: the day starts empty.
    }
    const budget = { day, bytes, truncated: bytes >= ACTIVITY_DAY_BYTES }
    this.budgets.set(appId, budget)
    return budget
  }

  /**
   * Writes the accumulated counts as `count` lines and waits for every pending append —
   * of one app, or of all. Never throws: a logging failure is not the caller's failure.
   */
  async flush(appId?: string): Promise<void> {
    const now = Date.now()
    const apps = appId === undefined ? [...this.counters.keys()] : [appId]
    for (const id of apps) {
      for (const [name, counter] of this.counters.get(id) ?? []) {
        if (counter.calls === 0) continue
        this.append(id, { v: 1, ts: now, kind: 'count', name, ...counter })
      }
      this.counters.delete(id)
    }
    const pending = appId === undefined ? [...this.chains.values()] : [this.chains.get(appId) ?? Promise.resolve()]
    await Promise.all(pending)
  }

  private serialize<T>(appId: string, fn: () => Promise<T>): Promise<T> {
    const next = (this.chains.get(appId) ?? Promise.resolve()).then(fn, fn)
    this.chains.set(
      appId,
      next.catch(() => undefined)
    )
    return next
  }
}

function parseLine(line: string): MiniAppActivityEntry | undefined {
  if (!line) return undefined
  try {
    const parsed = MiniAppActivityEntrySchema.safeParse(JSON.parse(line))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

export const miniAppActivityLog = new MiniAppActivityLog()
