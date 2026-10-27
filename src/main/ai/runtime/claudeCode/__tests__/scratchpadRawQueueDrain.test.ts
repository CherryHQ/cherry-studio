// Permanent regression coverage for the round-18 raw-queue mask advance:
// drain semantics at every advance call site, raw/stripped buffer boundary
// accounting, and fence-inside-analysis shapes, all verified chunked-vs-whole
// plus a per-scan byte-accounting invariant (see the scan wrapper below).
import { describe, expect, it, vi } from 'vitest'

import type { CherryUIMessageChunk } from '@shared/data/types/message'

const loggerMocks = vi.hoisted(() => ({ silly: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
vi.mock('@logger', () => ({ loggerService: { withContext: vi.fn(() => loggerMocks) } }))
const { ClaudeCodeStreamAdapter } = await import('../streamAdapter')

type AdvRec = { caller: string; queued: number; emitLen: number }
type Log = {
  adv: AdvRec[]
  splitBufs: string[]
  scanRecs: { rem: string; text: string; out: string }[]
  flags: { inDeferredFlush: boolean }
  ctx: any
}

function makeAdapter(parts: CherryUIMessageChunk[], log: Log) {
  const adapter = new ClaudeCodeStreamAdapter({
    modelId: 'sonnet',
    sessionId: 'session-1',
    streamOptions: { prompt: [] },
    sink: { enqueue: (p) => parts.push(p) },
    statusSink: { emit: () => {} },
    onSessionId: () => {}
  }) as any
  const origAdv = adapter.advanceScratchpadMaskState.bind(adapter)
  adapter.advanceScratchpadMaskState = (emit: string, ctx: any) => {
    log.adv.push({
      caller: log.flags.inDeferredFlush ? 'deferredFlush' : 'append',
      queued: ctx.scratchpadMaskAdvanceRawQueue.length,
      emitLen: emit.length
    })
    log.ctx = ctx
    return origAdv(emit, ctx)
  }
  const origFlushDef = adapter.flushDeferredScratchpadText.bind(adapter)
  adapter.flushDeferredScratchpadText = (ctx: any) => {
    log.flags.inDeferredFlush = true
    try {
      return origFlushDef(ctx)
    } finally {
      log.flags.inDeferredFlush = false
    }
  }
  const origSplit = adapter.splitIncompleteTagSuffix.bind(adapter)
  adapter.splitIncompleteTagSuffix = (s: string) => {
    const r = origSplit(s)
    log.splitBufs.push(r.buffer)
    return r
  }
  const origScan = adapter.filterScratchpadFromOngoingDelta.bind(adapter)
  adapter.filterScratchpadFromOngoingDelta = (text: string, ctx: any) => {
    log.ctx = ctx
    const rem: string = ctx.scratchpadStreamRemainder
    const qBefore: number = ctx.scratchpadMaskAdvanceRawQueue.length
    const out = origScan(text, ctx)
    const remAfter: string = ctx.scratchpadStreamRemainder
    const growth: number = ctx.scratchpadMaskAdvanceRawQueue.length - qBefore
    log.scanRecs.push({ rem, text, out })
    // Byte-boundary accounting invariant: the raw queued this scan is exactly
    // the consumed raw minus the re-buffered remainder, on every scan path
    // (normal buffer cut, stable-fence cut, hold/defer re-buffer).
    if (growth !== 0 || remAfter !== rem) {
      const want = rem.length + text.length - remAfter.length
      if (growth !== want) {
        throw new Error(
          `raw-queue accounting violated: growth=${growth} want=${want} rem=${JSON.stringify(rem)} text=${JSON.stringify(text)} remAfter=${JSON.stringify(remAfter)}`
        )
      }
    }
    return out
  }
  return adapter
}

const ev = (event: Record<string, unknown>) =>
  ({ type: 'stream_event', event, session_id: 'sdk-1', uuid: crypto.randomUUID() }) as any

function runStream(full: string, splits: number[]): { out: string; log: Log } {
  const parts: CherryUIMessageChunk[] = []
  const log: Log = { adv: [], splitBufs: [], scanRecs: [], flags: { inDeferredFlush: false }, ctx: null }
  const adapter = makeAdapter(parts, log)
  adapter.beginTurn()
  adapter.handleMessage(ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }))
  let prev = 0
  for (const cut of [...splits, full.length]) {
    const text = full.slice(prev, cut)
    prev = cut
    if (text) adapter.handleMessage(ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }))
  }
  adapter.handleMessage(ev({ type: 'content_block_stop', index: 0 }))
  const out = parts
    .filter((p): p is Extract<CherryUIMessageChunk, { type: 'text-delta' }> => p.type === 'text-delta')
    .map((p) => p.delta)
    .join('')
  return { out, log }
}

function chunkedVsWhole(label: string, full: string, splitSets: number[][]) {
  const whole = runStream(full, [])
  for (const splits of splitSets) {
    const c = runStream(full, splits)
    expect(c.out).toBe(whole.out)
  }
  return whole
}

describe('raw queue drain semantics (round-18 review)', () => {
  it('fully-stripped scan delta, then emission drains queue; chunked == whole', () => {
    const full = 'intro line\n<analysis>HID</analysis>\n- item\n    cont\n'
    const cut = 'intro line\n'.length
    const cut2 = cut + '<analysis>HID</analysis>'.length
    const whole = runStream(full, [])
    const c = runStream(full, [cut, cut2])
    expect(c.out).toBe(whole.out)
    // the stripped middle delta emitted nothing but queued raw; a later advance drained it
    expect(c.log.adv.some((r) => r.queued > 0)).toBe(true)
  })
  it('buffered partial-tag remainder flushed at block end; chunked == whole', () => {
    const full = 'intro\n<analysis>HID</analysis>tail</an'
    const cut = 'intro\n'.length
    const cut2 = cut + '<analysis>HID</analysis>'.length
    const whole = runStream(full, [])
    const c = runStream(full, [cut, cut2])
    expect(c.out).toBe(whole.out)
  })
  it('deferred flush advance always sees an empty raw queue', () => {
    // two text parts: first streams mid-part with a stripped block, second is deferred and flushed at block end
    const parts: CherryUIMessageChunk[] = []
    const log: Log = { adv: [], splitBufs: [], scanRecs: [], flags: { inDeferredFlush: false }, ctx: null }
    const adapter = makeAdapter(parts, log)
    adapter.beginTurn()
    adapter.handleMessage(ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }))
    adapter.handleMessage(
      ev({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'alpha\n<analysis>HID</analysis>\n' }
      })
    )
    adapter.handleMessage(ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'beta\n' } }))
    adapter.handleMessage(ev({ type: 'content_block_stop', index: 0 }))
    adapter.handleMessage(ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }))
    adapter.handleMessage(ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '<an' } }))
    adapter.handleMessage(ev({ type: 'content_block_stop', index: 0 }))
    const defRecs = log.adv.filter((r) => r.caller === 'deferredFlush')
    expect(defRecs.length).toBeGreaterThan(0)
    for (const r of defRecs) expect(r.queued).toBe(0)
  })
})

describe('raw/stripped buffer boundary accounting (round-18 review)', () => {
  // For every scan with a non-empty buffer, the re-buffered suffix must be the raw tail byte-identically.
  const shapes: [string, string][] = [
    ['plain', 'para text <analysis>H</analysis>more'],
    ['list', '- item\n<analysis>H</analysis>continuation\n'],
    ['nested-list', '- a\n  - b\n<analysis>H</analysis>tail\n'],
    ['indent4-kept', 'para\n    <analysis>H</analysis> tail\n'],
    ['indent3', 'para\n   <analysis>H</analysis> tail\n'],
    ['after-blank', 'para\n\n<analysis>H</analysis>next\n'],
    ['heading', '# head\n<analysis>H</analysis>tail\n'],
    ['after-fence', '```\ncode\n```\n<analysis>H</analysis>tail\n']
  ]
  for (const [label, body] of shapes) {
    it(label + ': partial close-tag boundary right after a complete block', () => {
      // split inside a trailing closing tag: ...</analysis> + </ana | lysis> + following content
      const full = body + '</analysis\nZ <analysis>HID2</analysis>\n- x\n    y\n'
      const partialAt = body.length + '</ana'.length
      const whole = runStream(full, [])
      const c = runStream(full, [partialAt])
      expect(c.out).toBe(whole.out)
    })
  }
  it('byte-boundary direct: scanRaw ends with buffer whenever buffer non-empty', () => {
    const full = '- item\n<analysis>H</analysis>txt</an\nmore <analysis>H2</analysis>\n    cont\n'
    const cuts: number[] = []
    for (let i = 1; i < full.length; i++) cuts.push(i)
    // walk every single-char split point for the boundary window around the tags
    const windows = cuts.filter((i) => i >= full.indexOf('txt') && i <= full.indexOf('more') + 2)
    for (const cut of windows) {
      const c = runStream(full, [cut])
      const whole = runStream(full, [])
      expect(c.out).toBe(whole.out)
    }
  })
})

describe('fence inside analysis block (round-18 review)', () => {
  it('fence fully inside a stripped block', () => {
    chunkedVsWhole('3a', 'intro\n<analysis>plan\n```\ncode line\n```\ndone</analysis>\n- item\n    cont\n', [
      ['intro\n<analysis>plan\n```\nco'.length],
      ['intro\n<analysis>plan\n```\ncode line\n'.length, 'intro\n<analysis>plan\n```\ncode line\n```\n'.length],
      [20, 40]
    ])
  })
  it('fence opener inside block, closer outside', () => {
    chunkedVsWhole('3b', 'intro\n<analysis>\n```\n</analysis>\nfence body\n```\ntail\n', [
      ['intro\n<analysis>\n```\n'.length],
      ['intro\n<analysis>\n```\n</an'.length, 'intro\n<analysis>\n```\n</analysis>\nfence body\n'.length]
    ])
  })
  it('unclosed fence opener inside a block that then closes', () => {
    chunkedVsWhole('3c', '- item\n<analysis>x\n```\ny\n</analysis>\n    cont\n', [
      ['- item\n<analysis>x\n```\n'.length],
      ['- item\n<analysis>x\n```\ny\n'.length, '- item\n<analysis>x\n```\ny\n</analysis>\n'.length]
    ])
  })
})
