import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createPiLoopGuardExtension,
  degeneracy,
  detectShellStop,
  extractNumbers,
  humanChars,
  isAdvancingGroup,
  isSeparatorUnit,
  largestString,
  lineLoop,
  loadConfig,
  riskyPattern,
  scanTail,
  toolSignature,
  wordStats,
  DEFAULT_CONFIG,
  type LoopGuardConfig,
  type TailSignalOptions
} from '../loopGuard'

type Handler = (event: unknown, ctx: unknown) => unknown

const cleanupDirs: string[] = []
afterEach(() => {
  while (cleanupDirs.length) rmSync(cleanupDirs.pop()!, { recursive: true, force: true })
})

function makeHarness(config: Partial<LoopGuardConfig> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cherry-loop-guard-'))
  cleanupDirs.push(dir)
  const configPath = join(dir, 'loop-guard.json')
  writeFileSync(configPath, JSON.stringify(config))
  const handlers = new Map<string, Handler[]>()
  const entries: Array<{ type: string; data: Record<string, unknown> }> = []
  const pi = {
    on: (name: string, fn: Handler) => {
      const arr = handlers.get(name) ?? []
      arr.push(fn)
      handlers.set(name, arr)
    },
    appendEntry: (type: string, data: Record<string, unknown>) => entries.push({ type, data })
  }
  const ctx = { abort: vi.fn() }
  const emit = (name: string, event: unknown) => (handlers.get(name) ?? []).map((fn) => fn(event, ctx))
  const create = createPiLoopGuardExtension({ configPath })
  ;(create as (api: unknown) => void)(pi)
  return { ctx, entries, emit }
}

function signalOpts(kind: 'prose' | 'toolcall', overrides: Partial<TailSignalOptions> = {}): TailSignalOptions {
  const prose = kind === 'prose'
  return {
    maxPeriod: DEFAULT_CONFIG.streamRepeatMaxPeriod,
    minSuffix: DEFAULT_CONFIG.streamRepeatMinSuffix,
    ratio: DEFAULT_CONFIG.streamRepeatRatio,
    phraseMinPeriod: DEFAULT_CONFIG.streamPhraseMinPeriod,
    phraseMaxPeriod: DEFAULT_CONFIG.streamPhraseMaxPeriod,
    phraseCopies: DEFAULT_CONFIG.streamPhraseCopies,
    phraseMinChars: DEFAULT_CONFIG.streamPhraseMinChars,
    words: prose,
    wordRunMin: DEFAULT_CONFIG.streamWordRunMin,
    wordFreqMin: DEFAULT_CONFIG.streamWordFreqMin,
    wordShare: DEFAULT_CONFIG.streamWordShare,
    lines: prose,
    lineMinChars: DEFAULT_CONFIG.streamLineMinChars,
    lineRepeatMin: DEFAULT_CONFIG.streamLineRepeatMin,
    lineGroupLines: DEFAULT_CONFIG.streamLineGroupLines,
    lineGroupRepeat: DEFAULT_CONFIG.streamLineGroupRepeat,
    phrase: prose,
    separatorsOk: !prose,
    ...overrides
  }
}

function turnEnd(message: unknown, entries: unknown[] = []) {
  return { type: 'turn_end', turnIndex: 0, message, toolResults: [], entries, outcome: 'completed' }
}

describe('loop-guard A1 cycle signal', () => {
  it('flags the tab/newline filler shape from the incident sessions', () => {
    const poison = '\t\t\t\t\n'.repeat(300)
    const d = degeneracy(poison, { minChars: 1024, minSuffix: 1024, ratio: 0.06, maxPeriod: 16 })
    expect(d.degenerate).toBe(true)
    expect(d.period).toBe(5)
  })

  it('flags pure word tiling that dodges the distinct-character cap', () => {
    const tiled = 'parser'.repeat(200)
    const d = degeneracy(tiled, { minChars: 1024, minSuffix: 1024, ratio: 0.06, maxPeriod: 16 })
    expect(d.degenerate).toBe(true)
    // 5 distinct characters: above the <=4 unit cap, so only the pure-word rule catches it.
    expect(d.unitDistinct).toBe(5)
  })

  it('passes a legitimate data file whose rows are individually unique', () => {
    const csv = Array.from({ length: 120 }, (_, i) => `row-${String(i).padStart(4, '0')},alpha,beta,gamma\n`).join('')
    const d = degeneracy(csv, { minChars: 1024, minSuffix: 1024, ratio: 0.06, maxPeriod: 16 })
    expect(d.degenerate).toBe(false)
  })

  it('exempts separator-line units on the toolcall channel only', () => {
    const separator = '-'.repeat(1200)
    expect(scanTail(separator, signalOpts('prose')).signal).toBe('cycle')
    expect(scanTail(separator, signalOpts('toolcall')).signal).toBe('')
  })

  it('recognizes separator units for the exemption', () => {
    expect(isSeparatorUnit('───')).toBe(true)
    expect(isSeparatorUnit('--- x')).toBe(false)
    expect(isSeparatorUnit('    ')).toBe(false)
  })
})

describe('loop-guard A2 phrase signal', () => {
  it('catches a mid-length verbatim tape loop', () => {
    const unit = 'The system rejected the request payload. '
    const v = scanTail(unit.repeat(10), signalOpts('prose'))
    expect(v.signal).toBe('phrase')
    expect(v.period).toBe(unit.length)
  })

  it('hands short-period sentence loops to the cycle gate instead', () => {
    // A 9-char sentence repeated 200x has base period 9 < 17: the phrase gate
    // must decline (documented non-target), and neither cycle (unit has Han
    // letters + punctuation, distinct > 4, not pure word) nor word/line gates
    // may claim it.
    const text = '这是一个测试句子。'.repeat(200)
    expect(scanTail(text, signalOpts('prose')).signal).toBe('')
  })

  it('requires the full evidence budget for long periods', () => {
    const unit = 'a'.repeat(17) + 'b'
    // 3 copies would be 54 chars < phraseMinChars 256: below the floor.
    expect(scanTail(unit.repeat(3), signalOpts('prose')).signal).toBe('')
    expect(scanTail(unit.repeat(20), signalOpts('prose')).signal).toBe('phrase')
  })
})

describe('loop-guard A3 word signals', () => {
  it('catches a single-word run', () => {
    const w = wordStats('parser '.repeat(40))
    expect(w.run).toBe(40)
    expect(w.token).toBe('parser')
  })

  it('catches top-word flooding by frequency and share', () => {
    const text = `${'parser '.repeat(70)}other words scattered between to lower the run`
    const v = scanTail(text, signalOpts('prose'))
    expect(['wordfreq', 'wordrun']).toContain(v.signal)
  })

  it('caps CJK tokens so distinct long sentences never glue a run', () => {
    const a = '这是一句很长的中文测试语料'.repeat(20)
    const b = '那是另外一句完全不同的中文语料哦'.repeat(20)
    expect(wordStats(`${a}${b}`).run).toBe(0)
  })

  it('breaks runs on tokens that are too short', () => {
    expect(wordStats('a b a b a b a b').run).toBe(0)
  })
})

describe('loop-guard A4 line signals', () => {
  it('catches one long line repeated past the threshold', () => {
    const line = 'systemctl restart cherry-agent && tail -n 5 /var/log/unit.log'
    const lf = lineLoop(Array.from({ length: 7 }, () => line).join('\n'), signalOpts('prose'))
    expect(lf.hit).toBe('linefreq')
    expect(lf.count).toBe(7)
  })

  it('catches a rotating group of lines each repeated enough times', () => {
    const lines = [
      'alpha build step one with padding',
      'bravo build step two with padding',
      'charlie build step three padding'
    ]
    const text = lines.flatMap((l) => Array.from({ length: 4 }, () => l)).join('\n')
    const lf = lineLoop(text, signalOpts('prose'))
    expect(lf.hit).toBe('linegroup')
    expect(lf.groupLines).toBe(3)
  })

  it('ignores separator rows, symbol-only rows, and short lines', () => {
    const text = Array.from({ length: 10 }, () => '------------------------').join('\n')
    expect(lineLoop(text, signalOpts('prose')).hit).toBe('')
  })
})

describe('loop-guard F shell-stop verdict', () => {
  it('flags a message whose entire body is tool-call close markers', () => {
    const verdict = detectShellStop({
      stopReason: 'stop',
      content: [
        { type: 'thinking', thinking: '' },
        { type: 'text', text: '</|DSML|> </|DSML|>' }
      ]
    })
    expect(verdict.shell).toBe(true)
    expect(verdict.markers).toBe(2)
  })

  it('does not flag a reply that merely quotes the markers', () => {
    const verdict = detectShellStop({
      stopReason: 'stop',
      content: [{ type: 'text', text: 'The raw payload contained </|DSML|> which indicates a serialization bug.' }]
    })
    expect(verdict.shell).toBe(false)
  })

  it('ignores tool-call messages and non-stop endings', () => {
    expect(detectShellStop({ stopReason: 'stop', content: [{ type: 'toolCall', id: 'x' }] }).shell).toBe(false)
    expect(detectShellStop({ stopReason: 'length', content: [{ type: 'text', text: '</|DSML|>' }] }).shell).toBe(false)
  })
})

describe('loop-guard pure helpers', () => {
  it('rejects ReDoS-shaped allow patterns statically', () => {
    expect(riskyPattern('(a+)+')).toBeTruthy()
    expect(riskyPattern('(a|ab)+')).toBeTruthy()
    expect(riskyPattern('^dotnet test')).toBeNull()
  })

  it('signatures are order-insensitive over object keys', () => {
    expect(toolSignature('bash', { a: 1, b: 2 })).toBe(toolSignature('bash', { b: 2, a: 1 }))
    expect(toolSignature('bash', { a: 1 })).not.toBe(toolSignature('read', { a: 1 }))
  })

  it('keeps filename hyphens out of the numbers while keeping real negatives', () => {
    expect(extractNumbers('read file-1.ts then file-2.ts')).toEqual([1, 2])
    expect(extractNumbers('retry with x=-1')).toEqual([-1])
  })

  it('requires every adjacent pair to advance before calling it pagination', () => {
    expect(isAdvancingGroup([[1], [2], [3]])).toBe(true)
    expect(isAdvancingGroup([[1], [2], [1]])).toBe(false)
    expect(isAdvancingGroup([[1]])).toBe(false)
  })

  it('finds the longest string field and survives deep nesting', () => {
    expect(largestString({ a: 'x', b: { c: 'yyy', d: ['zz', 'wwww'] } }).value).toBe('wwww')
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(largestString(circular).value).toBe('')
  })

  it('formats character counts for humans', () => {
    expect(humanChars(1500)).toBe('1.5K')
    expect(humanChars(2200000)).toBe('2.20M')
    expect(humanChars(42)).toBe('42')
  })
})

describe('loop-guard configuration', () => {
  it('keeps defaults when no config file exists', () => {
    const cfg = loadConfig(process.env, join(tmpdir(), 'cherry-loop-guard-missing', 'cfg.json'))
    expect(cfg).toMatchObject({ enabled: DEFAULT_CONFIG.enabled, argBlockChars: DEFAULT_CONFIG.argBlockChars })
  })

  it('applies file overrides, ignores unknown keys, and filters bad allowPatterns', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cherry-loop-guard-'))
    cleanupDirs.push(dir)
    const configPath = join(dir, 'loop-guard.json')
    writeFileSync(configPath, JSON.stringify({ argBlockChars: 555, bogusKey: 1, allowPatterns: ['^ok', 42] }))
    const cfg = loadConfig({}, configPath)
    expect(cfg.argBlockChars).toBe(555)
    expect(cfg.allowPatterns).toEqual(['^ok'])
  })

  it('accepts a zero rescue budget as a legal value', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cherry-loop-guard-'))
    cleanupDirs.push(dir)
    const configPath = join(dir, 'loop-guard.json')
    writeFileSync(configPath, JSON.stringify({ streamRescueMaxRetries: 0 }))
    expect(loadConfig({}, configPath).streamRescueMaxRetries).toBe(0)
  })

  it('lets the environment switch win', () => {
    expect(loadConfig({ PI_LOOP_GUARD: 'off' }, undefined).enabled).toBe(false)
    expect(loadConfig({ PI_LOOP_GUARD: 'on' }, undefined).enabled).toBe(true)
    expect(loadConfig({}, undefined).enabled).toBe(true)
  })
})

describe('loop-guard B/C gates on tool calls', () => {
  it('blocks a single oversized argument', () => {
    const h = makeHarness({ argBlockChars: 1000 })
    const result = h.emit('tool_call', {
      toolName: 'bash',
      toolCallId: 't1',
      input: { command: 'x'.repeat(2000) }
    })[0] as {
      block?: boolean
      terminate?: boolean
    }
    expect(result.block).toBe(true)
    expect(result.terminate).toBe(true)
    expect(h.entries.at(-1)?.data.kind).toBe('block')
  })

  it('blocks repeated-unit stacked arguments below the size cap', () => {
    const h = makeHarness({ argBlockChars: 100000, argRepeatMinChars: 500, argRepeatRatio: 0.9 })
    const poison = '\t\t\t\t\n'.repeat(200)
    const result = h.emit('tool_call', { toolName: 'bash', toolCallId: 't1', input: { command: poison } })[0] as {
      block?: boolean
    }
    expect(result.block).toBe(true)
  })

  it('lets healthy large arguments through with at most one warn per turn', () => {
    const h = makeHarness({ argBlockChars: 100000, argRepeatMinChars: 500, argWarnChars: 300 })
    const healthy = Array.from({ length: 50 }, (_, i) => `step ${i}: verify module ${i * 7} behaves`).join('\n')
    for (let i = 0; i < 5; i++) {
      const result = h.emit('tool_call', {
        toolName: 'write',
        toolCallId: `t${i}`,
        input: { path: `f${i}.txt`, content: healthy }
      })[0]
      expect(result).toBeUndefined()
    }
    expect(h.entries.filter((e) => e.data.kind === 'warn')).toHaveLength(1)
  })
})

describe('loop-guard D gate on repeated calls', () => {
  it('blocks after three consecutive identical calls and aborts once blocks pile up', () => {
    const h = makeHarness({})
    const call = () => h.emit('tool_call', { toolName: 'bash', toolCallId: 't', input: { command: 'sleep 1' } })[0]
    expect(call()).toBeUndefined()
    expect(call()).toBeUndefined()
    expect((call() as { block?: boolean }).block).toBe(true)
    expect((call() as { block?: boolean }).block).toBe(true)
    // The turn aborts when blocksThisTurn reaches maxBlocksPerTurn (4) — after
    // the 4th block, i.e. the 6th consecutive call.
    let last: unknown
    for (let i = 0; i < 2 && !h.ctx.abort.mock.calls.length; i++) last = call()
    expect((last as { block?: boolean }).block).toBe(true)
    expect(h.ctx.abort).toHaveBeenCalledTimes(1)
  })

  it('treats advancing numbers as pagination, not a loop', () => {
    const h = makeHarness({ approxRepeatWindowBlock: 4 })
    for (let i = 1; i <= 6; i++) {
      const result = h.emit('tool_call', {
        toolName: 'read',
        toolCallId: `t${i}`,
        input: { path: 'f.txt', offset: i }
      })[0]
      expect(result).toBeUndefined()
    }
  })

  it('blocks same-shape calls whose numbers do not advance', () => {
    const h = makeHarness({ approxRepeatWindowBlock: 4 })
    const offsets = [1, 2, 1, 2, 1]
    const results = offsets.map(
      (offset, i) => h.emit('tool_call', { toolName: 'read', toolCallId: `t${i}`, input: { path: 'f.txt', offset } })[0]
    )
    expect(results.at(-1)).toMatchObject({ block: true })
  })

  it('resets the repeat window when a new user turn starts', () => {
    const h = makeHarness({})
    const call = () => h.emit('tool_call', { toolName: 'bash', toolCallId: 't', input: { command: 'sleep 1' } })[0]
    call()
    call()
    expect((call() as { block?: boolean }).block).toBe(true)
    h.emit('before_agent_start', {})
    expect(call()).toBeUndefined()
    expect(call()).toBeUndefined()
    expect((call() as { block?: boolean }).block).toBe(true)
  })

  it('honors allowPatterns for the repeat gates while size gates still apply', () => {
    const h = makeHarness({ allowPatterns: ['^sleep'], argBlockChars: 50 })
    const ok = h.emit('tool_call', { toolName: 'bash', toolCallId: 't', input: { command: 'sleep 1' } })[0]
    expect(ok).toBeUndefined()
    const blocked = h.emit('tool_call', {
      toolName: 'bash',
      toolCallId: 't2',
      input: { command: `${'sleep 1'.repeat(20)} x` }
    })[0]
    expect((blocked as { block?: boolean }).block).toBe(true)
  })
})

describe('loop-guard E gates', () => {
  it('blocks past the per-minute rate and aborts at the abort line', () => {
    const h = makeHarness({ ratePerMinute: 3, rateAbortPerMinute: 5 })
    let last: unknown
    for (let i = 0; i < 6; i++) {
      last = h.emit('tool_call', { toolName: 'bash', toolCallId: `t${i}`, input: { command: `cmd ${i}` } })[0]
    }
    // Calls 4 and 5 cross the block and abort lines; the abort line wins.
    expect((last as { block?: boolean }).block).toBe(true)
    expect(h.ctx.abort).toHaveBeenCalled()
  })

  it('aborts when the per-turn argument budget is exceeded', () => {
    const h = makeHarness({ turnArgBudgetChars: 500 })
    const payload = { data: 'y'.repeat(200) }
    h.emit('tool_call', { toolName: 'write', toolCallId: 't1', input: payload })
    h.emit('tool_call', { toolName: 'write', toolCallId: 't2', input: payload })
    const third = h.emit('tool_call', { toolName: 'write', toolCallId: 't3', input: payload })[0] as {
      block?: boolean
      terminate?: boolean
    }
    expect(third.block).toBe(true)
    expect(third.terminate).toBe(true)
    expect(h.ctx.abort).toHaveBeenCalled()
  })
})

describe('loop-guard A gate on the live stream', () => {
  function stream(harness: ReturnType<typeof makeHarness>, delta: string) {
    harness.emit('message_start', { message: { role: 'assistant' } })
    return harness.emit('message_update', { assistantMessageEvent: { type: 'text_delta', delta } })
  }

  it('aborts the turn when the streaming tail degenerates', () => {
    const h = makeHarness({ streamRepeatMinSuffix: 64, streamCheckStep: 32, streamTailKeep: 256 })
    stream(h, '\t\t\t\t\n'.repeat(30))
    expect(h.ctx.abort).toHaveBeenCalledTimes(1)
    expect(h.entries.at(-1)?.data.kind).toBe('abort')
  })

  it('aborts once past the hard stream cap regardless of the check cadence', () => {
    const h = makeHarness({ streamHardMaxChars: 100, streamCheckStep: 100000 })
    stream(h, 'z'.repeat(200))
    expect(h.ctx.abort).toHaveBeenCalled()
  })

  it('stops scanning for the rest of the message after an abort', () => {
    const h = makeHarness({ streamRepeatMinSuffix: 64, streamCheckStep: 32, streamTailKeep: 256 })
    stream(h, '\t\t\t\t\n'.repeat(30))
    h.emit('message_update', { assistantMessageEvent: { type: 'text_delta', delta: '\t\t\t\t\n'.repeat(30) } })
    expect(h.ctx.abort).toHaveBeenCalledTimes(1)
  })
})

describe('loop-guard turn_end final sweep and rescue', () => {
  const poisoned = () => turnEnd({ stopReason: 'stop', content: [{ type: 'text', text: 'parser '.repeat(100) }] })

  it('auto-continues a poisoned message within the rescue budget, then gives up', () => {
    const h = makeHarness({})
    const first = h.emit('turn_end', poisoned())[0] as { continue?: boolean; entries?: Array<{ customType?: string }> }
    expect(first.continue).toBe(true)
    expect(first.entries?.at(-1)?.customType).toBe('loop-guard-stream-degenerate')
    expect((h.emit('turn_end', poisoned())[0] as { continue?: boolean }).continue).toBe(true)
    expect(h.emit('turn_end', poisoned())[0]).toBeUndefined()
    expect(h.entries.at(-1)?.data.gave_up).toBe(true)
  })

  it('never rescues a turn that called tools', () => {
    const h = makeHarness({})
    const event = turnEnd({
      stopReason: 'stop',
      content: [
        { type: 'text', text: 'parser '.repeat(100) },
        { type: 'toolCall', id: 't1' }
      ]
    })
    expect(h.emit('turn_end', event)[0]).toBeUndefined()
  })

  it('resets the rescue counter after a clean message', () => {
    const h = makeHarness({})
    h.emit('turn_end', poisoned())
    h.emit('turn_end', turnEnd({ stopReason: 'stop', content: [{ type: 'text', text: 'All checks passed.' }] }))
    const again = h.emit('turn_end', poisoned())[0] as { continue?: boolean }
    expect(again.continue).toBe(true)
  })

  it('leaves non-completed outcomes alone', () => {
    const h = makeHarness({})
    const event = { ...poisoned(), outcome: 'aborted' }
    expect(h.emit('turn_end', event)[0]).toBeUndefined()
  })
})

describe('loop-guard F shell-stop rescue', () => {
  const shell = () => turnEnd({ stopReason: 'stop', content: [{ type: 'text', text: '</|DSML|>' }] })

  it('auto-continues within the retry cap, then gives up', () => {
    const h = makeHarness({})
    const first = h.emit('turn_end', shell())[0] as { continue?: boolean; entries?: Array<{ customType?: string }> }
    expect(first.continue).toBe(true)
    expect(first.entries?.at(-1)?.customType).toBe('loop-guard-shell-stop')
    expect((h.emit('turn_end', shell())[0] as { continue?: boolean }).continue).toBe(true)
    expect(h.emit('turn_end', shell())[0]).toBeUndefined()
    expect(h.entries.at(-1)?.data.gave_up).toBe(true)
  })

  it('resets the counter after a normal reply', () => {
    const h = makeHarness({})
    h.emit('turn_end', shell())
    h.emit('turn_end', turnEnd({ stopReason: 'stop', content: [{ type: 'text', text: 'Done — tests pass.' }] }))
    expect((h.emit('turn_end', shell())[0] as { continue?: boolean }).continue).toBe(true)
  })
})

describe('loop-guard kill switch', () => {
  it('stops every gate when disabled', () => {
    const h = makeHarness({ enabled: false })
    expect(
      h.emit('tool_call', { toolName: 'bash', toolCallId: 't', input: { command: 'x'.repeat(5000) } })[0]
    ).toBeUndefined()
    h.emit('message_start', { message: { role: 'assistant' } })
    h.emit('message_update', { assistantMessageEvent: { type: 'text_delta', delta: '\t\t\t\t\n'.repeat(100) } })
    expect(h.ctx.abort).not.toHaveBeenCalled()
    const shellEvent = turnEnd({ stopReason: 'stop', content: [{ type: 'text', text: '</|DSML|>' }] })
    expect(h.emit('turn_end', shellEvent)[0]).toBeUndefined()
  })
})
