import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { shell } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mockMiniAppApplication } from './applicationMock'

vi.mock('@application', () => mockMiniAppApplication({}))

const { application } = await import('@application')
const { ACTIVITY_DAY_BYTES, ACTIVITY_DAYS_KEPT, MiniAppActivityLog } = await import('../activityLog')

const A = 'com.example.a'
let root: string
let svc: InstanceType<typeof MiniAppActivityLog>

const dirOf = (appId: string) => path.join(root, appId)
const filesOf = (appId: string) => (fs.existsSync(dirOf(appId)) ? fs.readdirSync(dirOf(appId)).sort() : [])
const linesOf = (appId: string) =>
  filesOf(appId)
    .flatMap((f) => fs.readFileSync(path.join(dirOf(appId), f), 'utf8').split('\n'))
    .filter(Boolean)
    .map((l) => JSON.parse(l))
/** Appends are queued per app; settle them the way the runtime does on stop. */
const settle = () => svc.flush()

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-activity-'))
  vi.mocked(application.getPath).mockImplementation(() => root)
  svc = new MiniAppActivityLog()
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('miniAppActivityLog', () => {
  it('records an outward call as one line with metadata only — never the text', async () => {
    // The bug this guards: a facet that carries the payload. The clipboard text is the
    // one thing a user would not want in a file that can end up in a diagnostics bundle.
    svc.recordCall(A, 'clipboard.write', 'ok', 3, { text: 'my password' }, { ok: true })
    await settle()

    const [line] = linesOf(A)
    expect(line).toMatchObject({ v: 1, kind: 'call', name: 'clipboard.write', outcome: 'ok', facet: { chars: 11 } })
    expect(JSON.stringify(line)).not.toContain('password')
  })

  it('keeps the host and status of a fetch, not the body', async () => {
    svc.recordCall(
      A,
      'network.fetch',
      'ok',
      120,
      { url: 'https://api.example.com/v1/secret?token=abc', body: 'c2VjcmV0' },
      { status: 200, headers: {}, body: 'cmVzcG9uc2U=' }
    )
    await settle()

    const [line] = linesOf(A)
    expect(line.facet).toEqual({ host: 'api.example.com', status: 200, bytes: 8 })
    expect(JSON.stringify(line)).not.toContain('token')
  })

  it('counts sandbox-internal calls instead of logging each, and flushes them as one line', async () => {
    for (let i = 0; i < 25; i++) svc.recordCall(A, 'storage.set', 'ok', 1, { key: 'k', value: 'vvvv' }, { ok: true })
    await settle()

    const lines = linesOf(A)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ kind: 'count', name: 'storage.set', calls: 25, bytes: 100 })
    expect(JSON.stringify(lines[0])).not.toContain('vvvv')
  })

  it('flushes one app on request and leaves the others counting', async () => {
    // The runtime flushes an app when its last guest goes; the other apps must not lose
    // their windows to it.
    svc.recordCall(A, 'storage.set', 'ok', 1, { key: 'k', value: 'v' }, { ok: true })
    svc.recordCall('com.example.b', 'storage.set', 'ok', 1, { key: 'k', value: 'v' }, { ok: true })

    await svc.flush(A)
    expect(linesOf(A)).toHaveLength(1)
    expect(filesOf('com.example.b')).toEqual([])

    await svc.flush()
    expect(linesOf('com.example.b')).toHaveLength(1)
  })

  it('always writes a refusal as its own line, even for a counted method', async () => {
    // An app probing what it was not granted is the thing the log exists to show.
    svc.recordCall(A, 'storage.get', 'PermissionDenied', 0, { key: 'k' }, undefined)
    await settle()

    expect(linesOf(A)).toEqual([
      expect.objectContaining({ kind: 'call', name: 'storage.get', outcome: 'PermissionDenied' })
    ])
  })

  it('keeps the reason a refusal came with, beside the facet the call already had', async () => {
    // `Unavailable` covers a dead provider AND a cleared app; the panel is where the user
    // separates them. Merged, not substituted — losing the call's own facet to carry it
    // would trade one blind spot for another.
    svc.recordCall(A, 'ai.chat', 'Unavailable', 4, { messages: [{ content: 'hi' }] }, undefined, 'AI_APICallError')
    await settle()

    const [line] = linesOf(A)
    expect(line).toMatchObject({
      outcome: 'Unavailable',
      facet: { reason: 'AI_APICallError', messages: 1, model: 'default' }
    })
  })

  it('records a permission decision', async () => {
    svc.recordGrant(A, { name: 'revoke', permissions: ['clipboard.read'] })
    await settle()

    expect(linesOf(A)).toEqual([
      expect.objectContaining({ kind: 'grant', name: 'revoke', permissions: ['clipboard.read'] })
    ])
  })

  it('keeps the newest activity days, however old they are', async () => {
    // Activity days, not calendar days: an app opened once a month must still show
    // its last session, so the sweep drops by count, never by age.
    fs.mkdirSync(dirOf(A), { recursive: true })
    const days = Array.from({ length: ACTIVITY_DAYS_KEPT + 3 }, (_, i) => `2020-01-${String(i + 1).padStart(2, '0')}`)
    for (const day of days)
      fs.writeFileSync(path.join(dirOf(A), `activity.${day}.log`), '{"v":1,"ts":0,"kind":"truncated"}\n')
    fs.writeFileSync(path.join(dirOf(A), 'notes.txt'), 'not a day file')

    svc.recordGrant(A, { name: 'grant', permissions: ['ai.chat'] })
    await settle()

    const kept = filesOf(A).filter((f) => f.startsWith('activity.'))
    expect(kept).toHaveLength(ACTIVITY_DAYS_KEPT)
    // Today's file plus the newest six of the old ones; the oldest four are gone.
    expect(kept).not.toContain('activity.2020-01-01.log')
    expect(kept).toContain('activity.2020-01-10.log')
    expect(filesOf(A)).toContain('notes.txt')
  })

  it('stops writing for the day past the byte budget, after one truncated marker', async () => {
    const big = { v: 1, ts: 1, kind: 'truncated' }
    fs.mkdirSync(dirOf(A), { recursive: true })
    const today = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const file = path.join(
      dirOf(A),
      `activity.${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}.log`
    )
    fs.writeFileSync(file, `${JSON.stringify(big)}\n`.repeat(Math.ceil(ACTIVITY_DAY_BYTES / 34)))

    svc.recordGrant(A, { name: 'grant', permissions: ['ai.chat'] })
    svc.recordGrant(A, { name: 'grant', permissions: ['ai.chat'] })
    await settle()

    const tail = fs.readFileSync(file, 'utf8').trimEnd().split('\n').slice(-2)
    expect(JSON.parse(tail[1])).toMatchObject({ kind: 'truncated' })
    expect(JSON.parse(tail[0])).not.toMatchObject({ kind: 'grant' })
  })

  it('lists newest first, filters to refusals, and skips a torn line', async () => {
    svc.recordCall(A, 'clipboard.read', 'ok', 1, undefined, { text: 'abc' })
    svc.recordCall(A, 'network.fetch', 'PermissionDenied', 1, { url: 'https://x.example.com/' }, undefined)
    await settle()
    const [file] = filesOf(A)
    fs.appendFileSync(path.join(dirOf(A), file), '{"v":1,"ts":9,"kind":"call","na')

    const all = await svc.list(A, { limit: 10, deniedOnly: false })
    expect(all.entries.map((e) => e.kind === 'call' && e.name)).toEqual(['network.fetch', 'clipboard.read'])
    const denied = await svc.list(A, { limit: 10, deniedOnly: true })
    expect(denied.entries.map((e) => e.kind === 'call' && e.outcome)).toEqual(['PermissionDenied'])
  })

  it('reports what the whole log weighs, across every kept day', async () => {
    fs.mkdirSync(dirOf(A), { recursive: true })
    fs.writeFileSync(path.join(dirOf(A), 'activity.2020-01-01.log'), 'x'.repeat(100))
    fs.writeFileSync(path.join(dirOf(A), 'activity.2020-01-02.log'), 'y'.repeat(50))

    const listing = await svc.list(A, { limit: 1, deniedOnly: false })

    // The size covers files the limit never read into entries.
    expect(listing).toMatchObject({ bytes: 150, days: 2 })
    expect(await svc.list('com.example.none', { limit: 1, deniedOnly: false })).toEqual({
      entries: [],
      bytes: 0,
      days: 0
    })
  })

  it('clears the whole log, and the next line starts it again', async () => {
    svc.recordGrant(A, { name: 'install', version: '1.0.0' })
    await settle()
    await svc.clear(A)
    expect(fs.existsSync(dirOf(A))).toBe(false)

    svc.recordGrant(A, { name: 'grant', permissions: ['ai.chat'] })
    await settle()
    expect(linesOf(A)).toHaveLength(1)
  })

  it('refuses a call landing after forget — unlike clear — until a new install', async () => {
    // Taking an app offline deliberately does not wait for in-flight capability calls
    // (design §2.1), and writes are serialized per app: an append queued after `forget`
    // therefore ran AFTER the delete and `mkdir`ed the log back for an app that is gone.
    svc.recordGrant(A, { name: 'install', version: '1.0.0' })
    await settle()
    await svc.forget(A)

    // Both write paths: a refusal takes the per-line branch, an `ok` count-tier call takes
    // the counter branch that `flush` writes out separately.
    svc.recordCall(A, 'network.fetch', 'denied', 5, { url: 'https://x.test/' }, undefined)
    svc.recordCall(A, 'storage.set', 'ok', 1, { key: 'k' }, undefined)
    await settle()
    expect(fs.existsSync(dirOf(A))).toBe(false)

    // The lift — and the control that stops the assertion above from passing for a log
    // that simply never writes again, which would silently break the next install.
    svc.recordGrant(A, { name: 'install', version: '2.0.0' })
    await settle()
    expect(linesOf(A)).toMatchObject([{ kind: 'grant', name: 'install', version: '2.0.0' }])
  })

  it('opens the log folder, creating it first so there is always something to open', async () => {
    // The global electron mock's `shell.openPath` is a bare `vi.fn()`; Electron resolves '' on success.
    vi.mocked(shell.openPath).mockResolvedValue('')

    await svc.openFolder(A)

    expect(fs.existsSync(dirOf(A))).toBe(true)
    expect(shell.openPath).toHaveBeenCalledWith(dirOf(A))
  })
})
