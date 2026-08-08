// A4 OOM benchmark — pure test-side measurement of MergeEngine peak memory at scale.
//
// Disposition: disposition-matrix node 3 (A4 = D9 performance family) — "design TBD".
// MergeEngine fully materializes every aggregate root (`scanAggregates` SELECT *.all()
// at MergeEngine.ts:600), each root's member rows (per-root chunked IN() at :1260-1271),
// every junction row (:1891), and every polymorphic-association row (:2009) into plain
// JS arrays. On a large library (long chat history / big knowledge base) those arrays
// grow unbounded and risk main-process OOM. The source TODO(Stage3) comments at :581,
// :1888, :2008 acknowledge the deferral — streaming merge is the fix, but it needs the
// owner's (@0xfullex) performance/size SLA, which is not yet set.
//
// This file does NOT change production merge semantics (bit-identical), does NOT define
// any SLA threshold, and does NOT gate the architecture. It only records observable
// memory + row-count + wall-clock data at three message scales so the owner can pick a
// streaming threshold from real numbers instead of a guess. Thresholds are owner-TBD.
//
// Run it explicitly (it is skipped by default so the normal `pnpm test` / CI gate stays
// fast — a 100k-row merge is minutes, not milliseconds):
//
//   RUN_BACKUP_OOM_BENCHMARK=1 pnpm vitest run \
//     src/main/services/reconciliation/__tests__/MergeEngine.oomBenchmark.test.ts
//
// Override the scales (defaults to 10k/50k/100k messages):
//
//   RUN_BACKUP_OOM_BENCHMARK=1 OOM_BENCHMARK_SCALES=1000,5000,10000 pnpm vitest run ...
//
// Sampling limitation (documented, not fixable test-side): the merge write tx is
// synchronous (better-sqlite3 requires a sync callback — see MergeEngine.ts:513), so the
// Node event loop is blocked while the materialized arrays live. A setInterval sampler on
// this thread therefore cannot observe the true in-tx peak. We instead snapshot RSS +
// heapUsed immediately before and after the full `mergeBackupIntoWork` call — the
// after-snapshot still holds the allocations V8 has not returned to the OS, so the delta
// is a lower bound on transient peak (real peak inside the tx is >= this delta). For a
// cleaner baseline, run Node with --expose-gc so the "before" snapshot is taken after a
// full GC pass (global.gc is used opportunistically when present).

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

import { contributorManager } from '@main/services/backup/contributors/ContributorManager'
import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { afterAll, describe, expect, it } from 'vitest'

import { MergeEngine } from '../MergeEngine'
import type { MergeContext } from '../types'

// Gate: heavy benchmark — off by default to keep `pnpm test` / CI fast.
const ENABLED = process.env.RUN_BACKUP_OOM_BENCHMARK === '1'

// Message scales to benchmark. Parsing is forgiving: split on commas, drop junk.
const parseScales = (): number[] => {
  const raw = process.env.OOM_BENCHMARK_SCALES
  if (!raw) return [10_000, 50_000, 100_000]
  return raw
    .split(',')
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b)
}
const SCALES = parseScales()

// Messages per topic (aggregate root). More roots => larger `decisions` array + more
// per-root member queries; more messages/root => larger per-root memberRows. 10 keeps a
// realistic chat shape while still producing O(S/10) roots at the S scale.
const MSGS_PER_TOPIC = 10

/** KBec of a single scale's recorded measurements — logged for the owner. */
interface ScaleResult {
  scale: number
  topicsSeeded: number
  messagesSeeded: number
  fileRefsSeeded: number
  knowledgeBasesSeeded: number
  knowledgeItemsSeeded: number
  rssBeforeMb: number
  rssAfterMb: number
  rssDeltaMb: number
  heapBeforeMb: number
  heapAfterMb: number
  heapDeltaMb: number
  mergeMs: number
  // Backed-up row counts (per-domain, post-merge) — sanity that the import happened.
  topicRows: number
  messageRows: number
  fileRefRows: number
  knowledgeBaseRows: number
  knowledgeItemRows: number
  degradedToSkips: number
}

const results: ScaleResult[] = []

// Use describe.skip when not enabled so the suite reports a single skipped block instead
// of silently running nothing. Vitest exposes describe.skip for exactly this.
const block = ENABLED ? describe : describe.skip

block('MergeEngine OOM benchmark (A4 — peak memory at scale, owner SLA TBD)', () => {
  // Live test DB = the merge base (work.sqlite). Production migrations + FTS5 triggers.
  const dbh = setupTestDatabase()
  const registry = contributorManager.getRegistry()

  let tmpDir: string
  let backupPath: string

  // Per-scale isolated backup file (cloned from the truncated work schema).
  async function freshBackup(): Promise<void> {
    tmpDir = await mkdtemp(join(tmpdir(), 'cs-oom-'))
    backupPath = join(tmpDir, 'backup.sqlite')
    await dbh.sqlite.backup(backupPath)
  }

  const seedBackup = (seed: (db: Database.Database) => void): void => {
    const db = new Database(backupPath)
    try {
      db.pragma('foreign_keys = ON')
      db.transaction(seed)(db)
    } finally {
      db.close()
    }
  }

  /**
   * Seed a large TOPICS + KNOWLEDGE library into the backup file, and pre-plant the
   * file_entry FK targets into WORK so chat_message_file_ref.file_entry_id resolves
   * cleanly (file_entry is owned by FILE_STORAGE, not in the merged domain set — without
   * local targets the dangling-ref repair path would run and pollute the memory signal
   * with repair-specific allocations rather than the materialization path under test).
   *
   * Shape per scale S (messages):
   *   topics            = ceil(S / MSGS_PER_TOPIC)   — aggregate ROOTS (drives decisions[])
   *   messages          = exactly S                   — 1 root msg + (MSGS_PER_TOPIC-1) children per topic
   *   chat_message_file_ref = 1 per topic            — nested include member (sourceId -> message)
   *   file_entry (work) = 1 per topic                 — FK target, pre-planted in work
   *   knowledge_base    = max(1, floor(S / 1000))     — KNOWLEDGE roots
   *   knowledge_item    = floor(S / 10)               — KNOWLEDGE members
   */
  function seedLargeLibrary(messageTarget: number): {
    topics: number
    messages: number
    fileRefs: number
    knowledgeBases: number
    knowledgeItems: number
  } {
    const topics = Math.ceil(messageTarget / MSGS_PER_TOPIC)
    const knowledgeBases = Math.max(1, Math.floor(messageTarget / 1000))
    // knowledge_item is distributed evenly across the knowledge_base roots. Computed here
    // (outside the seed callback) so the returned count matches the rows actually inserted.
    const itemsPerKb = knowledgeBases > 0 ? Math.floor(Math.floor(messageTarget / 10) / knowledgeBases) : 0
    const knowledgeItems = knowledgeBases * itemsPerKb
    const now = Date.now()
    // A modest-but-non-trivial message payload so per-row memory is realistic, not a
    // 2-byte stub. {parts:[{type:text,text:'...'}]} mirrors the AI SDK UIMessage shape.
    const dataJson = JSON.stringify({ parts: [{ type: 'text', text: 'benchmark message body '.repeat(8) }] })

    // file_entry FK targets into WORK (merge base) — one per topic, id-matched to the
    // chat_message_file_ref rows seeded into backup below.
    const insertWorkFileEntry = dbh.sqlite.prepare(
      `INSERT INTO file_entry (id, origin, name, external_path, created_at, updated_at)
       VALUES (?, 'external', ?, ?, ?, ?)`
    )
    for (let t = 0; t < topics; t++) {
      const feId = `fe-${t}`
      insertWorkFileEntry.run(feId, feId, `/tmp/${feId}`, now, now)
    }

    seedBackup((db) => {
      const insertFileEntry = db.prepare(
        `INSERT INTO file_entry (id, origin, name, external_path, created_at, updated_at)
         VALUES (?, 'external', ?, ?, ?, ?)`
      )
      const insertTopic = db.prepare(
        `INSERT INTO topic (id, name, is_name_manually_edited, order_key, created_at, updated_at)
         VALUES (?, ?, 0, ?, ?, ?)`
      )
      const insertMessage = db.prepare(
        `INSERT INTO message (id, parent_id, topic_id, role, data, searchable_text, status, siblings_group_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '', 'success', 0, ?, ?)`
      )
      const insertFileRef = db.prepare(
        `INSERT INTO chat_message_file_ref (id, source_id, file_entry_id, role, created_at, updated_at)
         VALUES (?, ?, ?, 'attachment', ?, ?)`
      )
      const insertKb = db.prepare(
        `INSERT INTO knowledge_base (id, name, embedding_model_id, dimensions, status, chunk_size, chunk_overlap, chunk_strategy, chunk_separator, created_at, updated_at)
         VALUES (?, ?, NULL, NULL, 'completed', 500, 50, 'structured', '\n\n', ?, ?)`
      )
      const insertKi = db.prepare(
        `INSERT INTO knowledge_item (id, base_id, group_id, type, data, status, created_at, updated_at)
         VALUES (?, ?, NULL, 'file', '{}', 'idle', ?, ?)`
      )

      for (let t = 0; t < topics; t++) {
        const topicId = `tpc-${t}`
        insertTopic.run(topicId, `topic-${t}`, `order-${t}`, now, now)
        // Virtual root message (parentId NULL) — one per topic (message_topic_root_uniq).
        const rootMsgId = `msg-${t}-0`
        insertMessage.run(rootMsgId, null, topicId, 'root', dataJson, now, now)
        // Child messages (parentId -> root) — fills out the rest of MSGS_PER_TOPIC.
        for (let m = 1; m < MSGS_PER_TOPIC; m++) {
          insertMessage.run(`msg-${t}-${m}`, rootMsgId, topicId, 'assistant', dataJson, now, now)
        }
        // file_entry row in BACKUP so chat_message_file_ref.file_entry_id satisfies the
        // backup's own FK during seed (FILE_STORAGE is not a merged domain, so these rows
        // are never imported — the post-merge FK target is the work-side copy planted above).
        insertFileEntry.run(`fe-${t}`, `fe-${t}`, `/tmp/fe-${t}`, now, now)
        // One nested file ref on the first child — exercises chat_message_file_ref
        // (nested include member via sourceId -> message) at scale.
        insertFileRef.run(`ref-${t}`, `msg-${t}-1`, `fe-${t}`, now, now)
      }

      // KNOWLEDGE domain: knowledge_base roots + knowledge_item members.
      for (let kb = 0; kb < knowledgeBases; kb++) {
        insertKb.run(`kb-${kb}`, `kb-${kb}`, now, now)
      }
      let kiIdx = 0
      for (let kb = 0; kb < knowledgeBases; kb++) {
        for (let i = 0; i < itemsPerKb; i++) {
          insertKi.run(`ki-${kiIdx}`, `kb-${kb}`, now, now)
          kiIdx += 1
        }
      }
    })

    return {
      topics,
      messages: topics * MSGS_PER_TOPIC,
      fileRefs: topics,
      knowledgeBases,
      knowledgeItems
    }
  }

  const runMerge = (ctx: MergeContext) => new MergeEngine(registry).mergeBackupIntoWork(dbh.sqlite, dbh.db, ctx)

  const count = (table: string): number =>
    (dbh.sqlite.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c

  for (const scale of SCALES) {
    // Timeout scales with the workload: ~3ms/message headroom, floored at 60s. The 100k
    // case can take a couple of minutes (per-root member queries over many roots).
    const timeoutMs = Math.max(60_000, scale * 3)

    it(
      `peak RSS merging ${scale.toLocaleString()} messages (TOPICS + KNOWLEDGE)`,
      async () => {
        await freshBackup()
        const seeded = seedLargeLibrary(scale)

        // Baseline snapshot — force a GC pass first when --expose-gc is available so the
        // "before" reflects steady state rather than leftover allocations from seeding.
        if (typeof (globalThis as { gc?: unknown }).gc === 'function') {
          ;(globalThis as { gc: () => void }).gc()
        }
        const rssBefore = process.memoryUsage().rss
        const heapBefore = process.memoryUsage().heapUsed
        const t0 = performance.now()

        const result = await runMerge({
          backupDbPath: backupPath,
          domains: ['TOPICS', 'KNOWLEDGE'],
          skippedFileEntryIds: new Set<string>(),
          stagedFileEntryIds: new Set<string>()
        })

        const t1 = performance.now()
        const rssAfter = process.memoryUsage().rss
        const heapAfter = process.memoryUsage().heapUsed

        const MB = 1024 * 1024
        const res: ScaleResult = {
          scale,
          topicsSeeded: seeded.topics,
          messagesSeeded: seeded.messages,
          fileRefsSeeded: seeded.fileRefs,
          knowledgeBasesSeeded: seeded.knowledgeBases,
          knowledgeItemsSeeded: seeded.knowledgeItems,
          rssBeforeMb: Number((rssBefore / MB).toFixed(1)),
          rssAfterMb: Number((rssAfter / MB).toFixed(1)),
          rssDeltaMb: Number(((rssAfter - rssBefore) / MB).toFixed(1)),
          heapBeforeMb: Number((heapBefore / MB).toFixed(1)),
          heapAfterMb: Number((heapAfter / MB).toFixed(1)),
          heapDeltaMb: Number(((heapAfter - heapBefore) / MB).toFixed(1)),
          mergeMs: Math.round(t1 - t0),
          topicRows: count('topic'),
          messageRows: count('message'),
          fileRefRows: count('chat_message_file_ref'),
          knowledgeBaseRows: count('knowledge_base'),
          knowledgeItemRows: count('knowledge_item'),
          degradedToSkips: result.degradedToSkips.length
        }
        results.push(res)

        // Per-scale record (owner reads these to set the SLA — NO threshold asserted here).

        console.log(`[A4 OOM benchmark] scale=${scale.toLocaleString()} msgs`, res)

        // Sanity only — the merge completed and imported the seeded rows. This is NOT a
        // memory SLA (owner TBD); it just guards against a silently-empty / no-op merge
        // that would make the recorded numbers meaningless.
        expect(res.messageRows).toBeGreaterThanOrEqual(seeded.messages)
        expect(res.topicRows).toBeGreaterThanOrEqual(seeded.topics)
        expect(res.knowledgeItemRows).toBeGreaterThanOrEqual(seeded.knowledgeItems)
        expect(Array.isArray(result.degradedToSkips)).toBe(true)

        await rm(tmpDir, { recursive: true, force: true })
      },
      timeoutMs
    )
  }

  afterAll(() => {
    if (results.length === 0) return
    // Summary table — the durable artifact for the owner's SLA decision. Every column is
    // an observation; none is a pass/fail gate.

    console.log('[A4 OOM benchmark] summary — owner SLA TBD (no thresholds asserted)')

    console.table(
      results.map((r) => ({
        msgs: r.scale,
        'roots(topic)': r.topicsSeeded,
        'rss Δ(MB)': r.rssDeltaMb,
        'rss after(MB)': r.rssAfterMb,
        'heap Δ(MB)': r.heapDeltaMb,
        'merge(s)': Number((r.mergeMs / 1000).toFixed(2)),
        'msg rows': r.messageRows,
        'ki rows': r.knowledgeItemRows,
        degradations: r.degradedToSkips
      }))
    )
  })
})
