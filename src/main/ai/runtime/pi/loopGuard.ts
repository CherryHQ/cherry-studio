/**
 * pi loop guard — a wallet gate against model degeneration loops.
 *
 * Ports the six-gate design of github.com/angri450/pi-loop-guard (MIT) onto
 * Cherry's pi runtime. Every threshold below is incident-derived, not invented:
 * the defaults were tuned on real runaway sessions (a 2h57m stream that burned
 * 2.2M characters of tab/newline filler; 432 identical bash calls across 78
 * minutes at ~200K input tokens each), and the gates only fire on exact
 * repetition evidence — fuzzy similarity signals were measured to misfire on
 * legitimate long thinking and were deliberately left out.
 *
 * Gates, cheapest first:
 *   A  stream degeneration (message_update, four exact signals + turn_end
 *      final sweep with one bounded auto-continue rescue)
 *   B  argument size (tool_call)
 *   C  argument degeneration — repeated-unit stacking below the size cap
 *   D  repeated invocation (exact / approximate signatures, pagination-aware)
 *   E  rate + per-turn argument budget
 *   F  shell-tool-call stops (assistant emits only tool-call close markers)
 *
 * Blocks feed the reason back to the model so it can change strategy; aborts
 * end the turn and wait for the user. Every decision is appended to the pi
 * session as a `loop-guard` entry (never enters the LLM context).
 *
 * Cherry adaptations vs. the standalone extension: no TUI surface (status
 * item, entry renderer, /loop-guard command) — sessions are hosted, so user
 * overrides live in a config file instead of slash commands, and alerts go to
 * the main-process logger.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

import type {
  ExtensionContext,
  ExtensionFactory,
  MessageStartEvent,
  MessageUpdateEvent,
  ToolCallEvent,
  ToolCallEventResult,
  TurnEndEvent,
  TurnEndEventResult
} from '@earendil-works/pi-coding-agent'

import { loggerService } from '@logger'

const logger = loggerService.withContext('PiLoopGuard')

// ---------------------------------------------------------------- configuration

export interface LoopGuardConfig {
  enabled: boolean
  /** A: hard character cap for one assistant message. */
  streamHardMaxChars: number
  /** A: run a degeneration check every this many characters. */
  streamCheckStep: number
  /** A: observation window kept for the tail checks. */
  streamTailKeep: number
  /** A1 (cycle): minimum repeated-suffix length treated as evidence. */
  streamRepeatMinSuffix: number
  /** A1 (cycle): suffix share floor (evidence floor above is the real gate). */
  streamRepeatRatio: number
  /** A1 (cycle): maximum repetition period. */
  streamRepeatMaxPeriod: number
  /** A2 (phrase): minimum mid-length tape-loop period; periods below belong to A1. */
  streamPhraseMinPeriod: number
  /** A2 (phrase): maximum tape-loop period; min > max disables the signal. */
  streamPhraseMaxPeriod: number
  /** A2 (phrase): exact copies a mid-length unit must repeat. */
  streamPhraseCopies: number
  /** A2 (phrase): absolute evidence floor in characters. */
  streamPhraseMinChars: number
  /** A3 (wordrun): consecutive identical words to trip. */
  streamWordRunMin: number
  /** A3 (wordfreq): occurrences of the top word (with share) to trip. */
  streamWordFreqMin: number
  /** A3 (wordfreq): top-word share of all tokens. */
  streamWordShare: number
  /** A4 (lines): minimum line length counted. */
  streamLineMinChars: number
  /** A4 (linefreq): repeats of one line to trip. */
  streamLineRepeatMin: number
  /** A4 (linegroup): distinct lines each repeating >= lineGroupRepeat to trip. */
  streamLineGroupLines: number
  /** A4 (linegroup): per-line repeat count for group membership. */
  streamLineGroupRepeat: number
  /** A final sweep: share/ratio that marks a whole message as poisoned. */
  streamRescueRatio: number
  /** A final sweep: auto-continue budget per session (0 = alert only). */
  streamRescueMaxRetries: number
  /** B: per-field warn threshold. */
  argWarnChars: number
  /** B: per-field block threshold. */
  argBlockChars: number
  /** C: minimum length before degeneration is measured. */
  argRepeatMinChars: number
  /** C: repeated-suffix share that marks stacked output. */
  argRepeatRatio: number
  /** E2: per-turn cumulative tool-argument character budget. */
  turnArgBudgetChars: number
  /** D: sliding window size (calls). */
  windowSize: number
  /** D: consecutive identical calls that block. */
  repeatConsecutiveBlock: number
  /** D: identical calls in window that block. */
  repeatWindowBlock: number
  /** D: identical calls in window that abort the turn. */
  repeatWindowAbort: number
  /** D: approximate (numbers-masked) window block, unless the numbers advance. */
  approxRepeatWindowBlock: number
  /** E1: calls per minute that block. */
  ratePerMinute: number
  /** E1: calls per minute that abort the turn. */
  rateAbortPerMinute: number
  /** blocks per turn before the turn is aborted. */
  maxBlocksPerTurn: number
  /** D: regexes whose matches are exempt from the repeat gates (size/degeneration still apply). */
  allowPatterns: string[]
  /** F: enable the shell-tool-call-stop rescue. */
  shellStopGuard: boolean
  /** F: auto-continue budget for shell stops. */
  shellStopMaxRetries: number
  /** F: maximum body length still eligible for the shell-stop verdict. */
  shellStopMaxChars: number
}

export const DEFAULT_CONFIG: LoopGuardConfig = {
  enabled: true,
  streamHardMaxChars: 262144,
  streamCheckStep: 512,
  streamTailKeep: 16384,
  // Evidence floor only: a 1,024-char low-information periodic suffix is
  // poisoning on its own, regardless of total message length. An earlier
  // message-size floor let short poison streams (9,884 chars) slip through.
  streamRepeatMinSuffix: 1024,
  streamRepeatRatio: 0.06,
  streamRepeatMaxPeriod: 16,
  // 17..4096 with copies>=3; 17 abuts A1's max period so no gap exists.
  streamPhraseMinPeriod: 17,
  streamPhraseMaxPeriod: 4096,
  streamPhraseCopies: 3,
  streamPhraseMinChars: 256,
  streamWordRunMin: 32,
  streamWordFreqMin: 60,
  streamWordShare: 0.4,
  // No window-size floor for lines: line length x repeats IS the evidence
  // (3x4x16 = 192 chars minimum); a size floor re-created the bug above.
  streamLineMinChars: 16,
  streamLineRepeatMin: 6,
  streamLineGroupLines: 3,
  streamLineGroupRepeat: 4,
  streamRescueRatio: 0.6,
  streamRescueMaxRetries: 2,
  argWarnChars: 8192,
  argBlockChars: 131072,
  argRepeatMinChars: 8192,
  argRepeatRatio: 0.9,
  turnArgBudgetChars: 2000000,
  windowSize: 24,
  repeatConsecutiveBlock: 3,
  repeatWindowBlock: 5,
  repeatWindowAbort: 8,
  approxRepeatWindowBlock: 16,
  ratePerMinute: 120,
  rateAbortPerMinute: 240,
  maxBlocksPerTurn: 4,
  allowPatterns: [],
  shellStopGuard: true,
  shellStopMaxRetries: 2,
  shellStopMaxChars: 512
}

// ---------------------------------------------------------------- F gate: shell tool-call stops

/**
 * DeepSeek-style native tool-call close markers; the pipe may be fullwidth
 * U+FF5C (observed in the wild) or ASCII, both tolerated.
 */
const DSML_MARK_RE = /<\/?[^>]{0,4}[|\uff5c]{1,2}[^>]{0,4}DSML[\u200b-\u200f\ufeff ]*[|\uff5c]{1,2}\s*[^>]*>/gi

export interface ShellStopVerdict {
  shell: boolean
  /** Body left after stripping markers and whitespace. */
  residue: string
  /** Number of markers hit. */
  markers: number
}

/**
 * Decide whether an assistant message is an empty tool-call shell: it ended
 * "normally" without calling any tool, and its entire body is tool-call close
 * markers. Requiring the stripped body to be EMPTY is what separates the
 * failure from legitimate replies that merely quote such markers.
 */
export function detectShellStop(
  message: unknown,
  maxChars: number = DEFAULT_CONFIG.shellStopMaxChars
): ShellStopVerdict {
  const verdict: ShellStopVerdict = { shell: false, residue: '', markers: 0 }
  if (!message || typeof message !== 'object') return verdict
  const msg = message as { stopReason?: string; content?: unknown }
  if (msg.stopReason !== 'stop') return verdict
  const blocks: Array<{ type?: string; thinking?: string; text?: string }> = Array.isArray(msg.content)
    ? (msg.content as Array<{ type?: string; thinking?: string; text?: string }>)
    : []
  if (blocks.some((block) => block && block.type === 'toolCall')) return verdict
  const body = blocks
    .map((block) =>
      block && (block.type === 'thinking' || block.type === 'text') ? (block.thinking ?? block.text ?? '') : ''
    )
    .join('')
  if (!body || body.length > maxChars) return verdict
  const matches = body.match(DSML_MARK_RE)
  if (!matches || matches.length === 0) return verdict
  const residue = body
    .replace(DSML_MARK_RE, '')
    .replace(/[\s\u200b-\u200f\ufeff]+/g, '')
    .trim()
  if (residue.length > 0) return verdict
  verdict.shell = true
  verdict.markers = matches.length
  return verdict
}

// ---------------------------------------------------------------- configuration loading

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  configPath?: string
): LoopGuardConfig {
  const cfg: LoopGuardConfig = { ...DEFAULT_CONFIG, allowPatterns: [] }
  const file = configPath ?? (env.PI_LOOP_GUARD_CONFIG?.trim() || undefined)
  try {
    if (file && existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
      for (const key of Object.keys(DEFAULT_CONFIG) as (keyof LoopGuardConfig)[]) {
        const value = raw[key]
        if (value === undefined) continue
        if (key === 'allowPatterns') {
          if (Array.isArray(value))
            cfg.allowPatterns = value.filter((entry): entry is string => typeof entry === 'string')
          continue
        }
        if (key === 'enabled' || key === 'shellStopGuard') {
          if (typeof value === 'boolean') cfg[key] = value
          continue
        }
        if (key === 'streamRescueMaxRetries') {
          // 0 is legal (disables the A rescue); do not fall into the v > 0 branch below.
          if (typeof value === 'number' && Number.isFinite(value) && value >= 0) cfg[key] = Math.floor(value)
          continue
        }
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
          cfg[key] = value
        }
      }
    }
  } catch {
    // An unreadable config must never take the gates down; defaults hold.
  }
  const envSwitch = (env.PI_LOOP_GUARD ?? '').trim().toLowerCase()
  if (envSwitch === 'off' || envSwitch === '0' || envSwitch === 'false') cfg.enabled = false
  if (envSwitch === 'on' || envSwitch === '1' || envSwitch === 'true') cfg.enabled = true
  return cfg
}

// ---------------------------------------------------------------- pure functions (unit-testable)

/** Static ReDoS audit for user-written allow patterns. */

/**
 * `allowPatterns` are user regexes, but their input is model-generated tool
 * text. Nested quantifiers (`(a+)+$`) backtrack catastrophically — measured
 * x4 per extra character — and `re.test()` runs on EVERY tool call, with the
 * pattern persisted across sessions. Reject the shape outright.
 *
 * Returns null when the pattern looks safe; a string is the reason it is not.
 */
export function riskyPattern(source: string): string | null {
  // A quantifier directly qualifying a group that itself contains one:
  // `(a+)+`, `(a*)*`, `(\w+)*`, `([a-z]+){2,}`. Non-capturing groups count too.
  const nested = /\((?:[^()\\]|\\.)*[+*?}](?:[^()\\]|\\.)*\)\s*[+*{]/
  if (nested.test(source)) return 'quantifier nested in a quantified group (e.g. `(a+)+`) — catastrophic backtracking'
  // Alternation branches sharing a prefix under an outer quantifier: `(a|a)+`, `(a|ab)+`.
  if (/\((?:[^()\\]|\\.)*\|(?:[^()\\]|\\.)*\)\s*[+*]/.test(source))
    return 'alternation of overlapping branches under a quantifier (e.g. `(a|a)+`) — possible catastrophic backtracking'
  return null
}

/** One `re.test()` slower than this many ms disables the pattern (no repeat freezes). */
export const SLOW_PATTERN_MS = 50

export interface Degeneracy {
  degenerate: boolean
  /** Hit period in characters. */
  period: number
  /** Periodic suffix length. */
  suffix: number
  /** Suffix share of the text. */
  ratio: number
  /** Distinct characters in the probe window. */
  distinct: number
  /** Distinct characters in the repeated unit. */
  unitDistinct: number
  /** Whether the unit contains letters or digits. */
  unitHasAlnum: boolean
  /** The repeated unit verbatim (for separator exemption and trail samples). */
  unit: string
}

/** Low-information unit test: whitespace-only, symbol-only, or very few distinct characters. */
export function isLowInformationUnit(unit: string): { distinct: number; hasAlnum: boolean } {
  const distinct = new Set(unit).size
  const hasAlnum = /[\p{L}\p{N}]/u.test(unit)
  return { distinct, hasAlnum }
}

/**
 * Periodic-suffix detection: the longest suffix repeating with some period.
 * Cheap distinct-character prefilter first — text with many distinct
 * characters cannot be a short-period repetition.
 */
export function degeneracy(
  text: string,
  opts: {
    minChars?: number
    minSuffix?: number
    ratio?: number
    maxPeriod?: number
  } = {}
): Degeneracy {
  const minChars = opts.minChars ?? 8192
  const minSuffix = opts.minSuffix ?? 8192
  const ratio0 = opts.ratio ?? 0.9
  const maxPeriod = opts.maxPeriod ?? 16
  const n = text.length
  const empty: Degeneracy = {
    degenerate: false,
    period: 0,
    suffix: 0,
    ratio: 0,
    distinct: 0,
    unitDistinct: 0,
    unitHasAlnum: false,
    unit: ''
  }
  if (n < minChars) return empty
  const probe = text.slice(-512)
  const distinct = new Set(probe).size
  if (distinct > 24) return { ...empty, distinct }
  let best = 0
  let bestPeriod = 0
  let bestSkip = 0
  // The tail may carry a few non-periodic characters (closing quotes/brackets),
  // so allow skipping up to maxPeriod before scanning. Non-periodic text fails
  // after a couple of comparisons per start; a qualifying candidate stops the scan.
  scan: for (let skip = 0; skip <= maxPeriod && skip < n; skip++) {
    const end = n - 1 - skip
    for (let p = 1; p <= maxPeriod && p * 2 <= n; p++) {
      let i = end
      while (i - p >= 0 && text[i] === text[i - p]) i--
      const len = end - i
      if (len > best) {
        best = len
        bestPeriod = p
        bestSkip = skip
      }
      if (best >= minSuffix && best / n >= ratio0) break scan
    }
  }
  const ratio = best / n
  // The unit must be taken at the hit position, not at the very end — the tail
  // may be the skipped closing symbols.
  const unitEnd = n - bestSkip
  const unit = bestPeriod > 0 ? text.slice(Math.max(0, unitEnd - bestPeriod), unitEnd) : ''
  const { distinct: unitDistinct, hasAlnum: unitHasAlnum } = isLowInformationUnit(unit)
  // Low information is mandatory: an 8K+ fully-periodic legitimate file (CSV
  // rows, fixtures) also satisfies "periodic + high share". Only a unit with
  // no alphanumerics, or with very few distinct characters, is the degenerate
  // token loop (the real case was 4 tabs + newline). v0.6.0 addition: pure
  // word tiling (a unit of only letters/digits, no separators, e.g. `parser`
  // repeated) is also degenerate — legitimate content does not tile one word
  // for 1,024+ chars. Units containing spaces/punctuation/newlines (code
  // lines, CSV rows) keep the old tradeoff.
  const pureWord = unit.length > 0 && /^[\p{L}\p{N}]+$/u.test(unit)
  const lowInfo = unitDistinct <= 4 || !unitHasAlnum || pureWord
  return {
    degenerate: best >= minSuffix && ratio >= ratio0 && lowInfo,
    period: bestPeriod,
    suffix: best,
    ratio,
    distinct,
    unitDistinct,
    unitHasAlnum,
    unit
  }
}

// ---------------------------------------------------------------- A gate: four exact signals

/** Hit markers: cycle=A1 / phrase=A2 / wordrun+wordfreq=A3 / linefreq+linegroup=A4. */
export type TailSignal = 'cycle' | 'phrase' | 'wordrun' | 'wordfreq' | 'linefreq' | 'linegroup'

export interface TailVerdict {
  /** Hit signal; '' = no hit. */
  signal: TailSignal | ''
  period: number
  suffix: number
  ratio: number
  unit: string
  unitDistinct: number
  unitHasAlnum: boolean
  token: string
  run: number
  freq: number
  share: number
  line: string
  lineCount: number
  lineGroup: number
}

export interface TailSignalOptions {
  /** A1 */
  maxPeriod: number
  minSuffix: number
  ratio: number
  /** A2 (phraseMinPeriod > phraseMaxPeriod disables the signal). */
  phraseMinPeriod: number
  phraseMaxPeriod: number
  phraseCopies: number
  phraseMinChars: number
  /** A3 (words=false skips word statistics). */
  words: boolean
  wordRunMin: number
  wordFreqMin: number
  wordShare: number
  /** A4 (lines=false skips line statistics — the toolcall channel writes files with legitimately repeated lines). */
  lines: boolean
  lineMinChars: number
  lineRepeatMin: number
  lineGroupLines: number
  lineGroupRepeat: number
  /** A2 channel switch: true = disable (legitimate repetition in file writes far exceeds thinking). */
  phrase: boolean
  /** true = exempt pure-separator units (writing separator-line files is legitimate). */
  separatorsOk: boolean
}

/** Visual separators: hyphens/dashes/box-drawing/equals/stars/dots — repetition is drawing, not looping. */
const SEPARATOR_CHARS = new Set(Array.from('-–—─┄│┃═=*~.·・•'))

/** Whether the unit consists purely of separator characters (pure whitespace does NOT count). */
export function isSeparatorUnit(unit: string): boolean {
  if (!unit) return false
  for (const ch of unit) if (!SEPARATOR_CHARS.has(ch)) return false
  return true
}

/** Whether the text contains Han characters (caps CJK "words": no word boundaries, longer tokens are whole sentences). */
const HAS_HAN = /[\p{Script=Han}]/u

export interface WordStats {
  /** Longest run of consecutive identical words. */
  run: number
  /** That word. */
  token: string
  /** Occurrences of the most frequent word. */
  freq: number
  /** Top word's share of all tokens. */
  share: number
  total: number
}

/**
 * Word-level statistics: consecutive identical run plus top-word frequency.
 * CJK has no spaces, so a whole sentence matches as one long token — distinct
 * sentences never compare equal, so normal Chinese cannot trip this; only
 * repeated identical sentences/words do. Tokens under 2 chars (a, x, digits)
 * break the run so JSON/code fragments do not glue runs together.
 */
export function wordStats(text: string): WordStats {
  const raw = text.match(/[\p{L}\p{N}]+/gu)
  if (!raw || raw.length === 0) return { run: 0, token: '', freq: 0, share: 0, total: 0 }
  let run = 0
  let best = 0
  let bestTok = ''
  let prev = ''
  const freq = new Map<string, number>()
  for (const token0 of raw) {
    // Only real "words" count: tokens containing Han cap at 6 chars (CJK has
    // no word boundaries; longer matches are sentences), others cap at 16.
    // Long "identical line repeats" are a documented non-target (gate A1 owns
    // them via low-information); word signals catch single-word repetition
    // like `parser parser...`. Non-qualifying tokens neither count toward
    // frequency nor glue the run.
    const maxLen = HAS_HAN.test(token0) ? 6 : 16
    const token = token0.length >= 2 && token0.length <= maxLen ? token0.toLowerCase() : ''
    if (!token) {
      run = 0
      prev = ''
      continue
    }
    freq.set(token, (freq.get(token) ?? 0) + 1)
    if (token === prev) run++
    else {
      run = 1
      prev = token
    }
    if (run > best) {
      best = run
      bestTok = token
    }
  }
  let topFreq = 0
  for (const [, count] of freq) {
    if (count > topFreq) topFreq = count
  }
  return { run: best, token: bestTok, freq: topFreq, share: topFreq / raw.length, total: raw.length }
}

/**
 * A2 signal: the tail is an exact tape-loop of one mid-length unit (period
 * 17..4096). No low-information gate — this signal exists precisely for
 * verbatim re-broadcast of whole paragraphs/lines with unitDistinct > 4, which
 * A1's low-information gate would let through. Scanning from the smallest
 * period yields the most readable diagnostic.
 */
function phraseCheck(text: string, opts: TailSignalOptions): { period: number; suffix: number } | null {
  const n = text.length
  if (n < opts.phraseMinChars) return null
  // Base-period guard: first confirm the tail is NOT a short-period repetition
  // (q < phraseMinPeriod, which abuts A1's max period). Without this gate, a
  // 13-char Chinese sentence x300 would masquerade as periods p=39, 52... and
  // slip past A2 — verbatim identical-line repetition is A1's jurisdiction,
  // decided by the low-information gate.
  const guardLen = Math.min(n, opts.phraseMinChars)
  const guardStart = n - guardLen
  for (let q = 1; q < opts.phraseMinPeriod; q++) {
    if (guardLen < q * 2) break
    let ok = true
    for (let i = guardStart + q; i < n; i++) {
      if (text.charCodeAt(i) !== text.charCodeAt(i - q)) {
        ok = false
        break
      }
    }
    if (ok) return null // short-period repetition -> A1's jurisdiction
  }
  for (let p = opts.phraseMinPeriod; p <= opts.phraseMaxPeriod; p++) {
    const need = Math.max(opts.phraseMinChars, opts.phraseCopies * p)
    if (n < need) break // need grows monotonically; larger p only gets less possible
    const start = n - need
    let ok = true
    for (let i = start + p; i < n; i++) {
      if (text.charCodeAt(i) !== text.charCodeAt(i - p)) {
        ok = false
        break
      }
    }
    if (ok) return { period: p, suffix: need }
  }
  return null
}

/**
 * A4 signal: repeated lines and group loops inside the window — catches "a
 * group of commands/sentences cycling with noise in between", where
 * periodicity (A1/A2) is broken and word runs (A3) are cut at boundaries;
 * only line-level counting sees it. Exact counting only (identical lines), no
 * n-gram similarity. Three misfire guards: prose channels only (file writes
 * legitimately repeat lines), line length >= lineMinChars (short lines like
 * `---`/`done` are formatting), and the line must contain alphanumerics
 * (excludes frame/separator rows). No message-size floor: length x repeats is
 * the evidence. Known tradeoff: prose quoting a log with 6+ verbatim
 * identical long lines can misfire — raise streamLineRepeatMin or disable via
 * the config to trade that back.
 */
export interface LineLoopStats {
  /** '' = no hit. */
  hit: '' | 'linefreq' | 'linegroup'
  /** Most frequent line (sample, truncated to 120 chars). */
  line: string
  /** Its occurrence count. */
  count: number
  /** Distinct lines reaching the group threshold. */
  groupLines: number
  /** Share of the text covered by repeated lines (dominance gate for the rescue). */
  ratio: number
}

export function lineLoop(
  text: string,
  opts: Pick<TailSignalOptions, 'lines' | 'lineMinChars' | 'lineRepeatMin' | 'lineGroupLines' | 'lineGroupRepeat'>
): LineLoopStats {
  const out: LineLoopStats = { hit: '', line: '', count: 0, groupLines: 0, ratio: 0 }
  if (!opts.lines) return out
  if (!text) return out
  const counts = new Map<string, number>()
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.length < opts.lineMinChars) continue
    if (!/[\p{L}\p{N}]/u.test(line)) continue
    counts.set(line, (counts.get(line) ?? 0) + 1)
  }
  let top = ''
  let topN = 0
  let group = 0
  let groupChars = 0
  for (const [line, n] of counts) {
    if (n > topN) {
      topN = n
      top = line
    }
    if (n >= opts.lineGroupRepeat) {
      group++
      groupChars += n * line.length
    }
  }
  const total = text.length || 1
  if (topN >= opts.lineRepeatMin) {
    return {
      hit: 'linefreq',
      line: top.slice(0, 120),
      count: topN,
      groupLines: group,
      ratio: Math.min(1, (topN * top.length) / total)
    }
  }
  if (group >= opts.lineGroupLines) {
    return {
      hit: 'linegroup',
      line: top.slice(0, 120),
      count: topN,
      groupLines: group,
      ratio: Math.min(1, groupChars / total)
    }
  }
  return out
}

function emptyVerdict(): TailVerdict {
  return {
    signal: '',
    period: 0,
    suffix: 0,
    ratio: 0,
    unit: '',
    unitDistinct: 0,
    unitHasAlnum: false,
    token: '',
    run: 0,
    freq: 0,
    share: 0,
    line: '',
    lineCount: 0,
    lineGroup: 0
  }
}

/**
 * Run the four exact signals over an observation window (stream tail or a
 * finalized message); first hit wins. All judgments are exact on purpose:
 * fuzzy similarity/novelty signals measurably misfire on legitimate long
 * thinking; exact-only keeps the false-positive rate at zero. Cost order:
 * A1 -> A3 -> A4 -> A2.
 */
export function scanTail(text: string, opts: TailSignalOptions): TailVerdict {
  const out = emptyVerdict()
  if (!text) return out

  // A1: short-period low-information tail repetition (all channels; the
  // toolcall channel exempts pure separators).
  const d = degeneracy(text, {
    minChars: opts.minSuffix,
    minSuffix: opts.minSuffix,
    ratio: opts.ratio,
    maxPeriod: opts.maxPeriod
  })
  if (d.degenerate && !(opts.separatorsOk && isSeparatorUnit(d.unit))) {
    return {
      ...out,
      signal: 'cycle',
      period: d.period,
      suffix: d.suffix,
      ratio: d.ratio,
      unit: d.unit,
      unitDistinct: d.unitDistinct,
      unitHasAlnum: d.unitHasAlnum
    }
  }

  // A3: word-level runaway — covers A1's blind spot (unitDistinct > 4 word repetition).
  if (opts.words) {
    const w = wordStats(text)
    out.token = w.token
    out.run = w.run
    out.freq = w.freq
    out.share = w.share
    if (w.run >= opts.wordRunMin) return { ...out, signal: 'wordrun' }
    if (w.freq >= opts.wordFreqMin && w.share >= opts.wordShare) return { ...out, signal: 'wordfreq' }
  }

  // A4: repeated lines / group loops — covers A2's blind spot (noise-interleaved groups).
  const lf = lineLoop(text, opts)
  if (lf.hit) {
    return { ...out, signal: lf.hit, line: lf.line, lineCount: lf.count, lineGroup: lf.groupLines, ratio: lf.ratio }
  }

  // A2: mid-length tape-loop (verbatim paragraph/line re-broadcast).
  if (opts.phrase) {
    const hit = phraseCheck(text, opts)
    if (hit) {
      return {
        ...out,
        signal: 'phrase',
        period: hit.period,
        suffix: hit.suffix,
        ratio: hit.suffix / text.length,
        unit: text.slice(-hit.period)
      }
    }
  }
  return out
}

/** English labels for the signals (logger + trail). */
export function signalLabel(signal: TailSignal | ''): string {
  switch (signal) {
    case 'cycle':
      return 'stream degeneration loop (short-period repetition)'
    case 'phrase':
      return 'stream verbatim re-broadcast (long unit)'
    case 'wordrun':
      return 'stream single-word run'
    case 'wordfreq':
      return 'stream single-word flooding'
    case 'linefreq':
      return 'stream repeated lines'
    case 'linegroup':
      return 'stream group loop (rotating lines)'
    default:
      return 'stream degeneration'
  }
}

/** Extract the thinking + text body from an assistant message (excludes tool-call arguments). */
export function assistantBodyText(message: unknown): string {
  if (!message || typeof message !== 'object') return ''
  const blocks: Array<{ type?: string; thinking?: string; text?: string }> = Array.isArray(
    (message as { content?: unknown }).content
  )
    ? ((message as { content: unknown[] }).content as Array<{ type?: string; thinking?: string; text?: string }>)
    : []
  return blocks
    .map((block) =>
      block && (block.type === 'thinking' || block.type === 'text') ? `${block.thinking ?? block.text ?? ''}` : ''
    )
    .join('\n')
}

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>()
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v
    if (seen.has(v)) return '[circular]'
    seen.add(v)
    if (Array.isArray(v)) return v.map(walk)
    const out: Record<string, unknown> = {}
    const record = v as Record<string, unknown>
    for (const k of Object.keys(record).sort()) {
      out[k] = walk(record[k])
    }
    return out
  }
  try {
    return JSON.stringify(walk(value)) ?? 'null'
  } catch {
    return String(value)
  }
}

/** Exact signature: tool name + hash of the stable-serialized arguments. */
export function toolSignature(toolName: string, input: unknown): string {
  const h = createHash('sha1').update(stableStringify(input)).digest('hex').slice(0, 16)
  return `${toolName}:${h}`
}

/** Approximate signature: digits and whitespace masked before hashing — catches "change one number each time" loops. */
export function approxSignature(toolName: string, input: unknown): string {
  const s = stableStringify(input)
    .replace(/[0-9]+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
  const h = createHash('sha1').update(s).digest('hex').slice(0, 16)
  return `${toolName}~${h}`
}

/** Extract numbers from serialized arguments to recognize advancing pagination patterns. */
export function extractNumbers(text: string, cap = 32): number[] {
  const out: number[] = []
  // The negative lookbehind keeps `file-1.ts` hyphens from reading as minus
  // signs — without it, `file-1.ts`..`file-30.ts` extract as [-1]..[-30]
  // (decreasing), the pagination exemption fails, and sequential file reads
  // get blocked then aborted. Real negatives (`x=-1`, `a: -2`) still match:
  // their preceding character is not a word character or dot.
  const re = /(?<![\w.])-?\d+(?:\.\d+)?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null && out.length < cap) out.push(Number(m[0]))
  return out
}

/** Whether the current call's numbers are monotonically non-decreasing AND grew vs. the previous same-shape call. */
export function isAdvancing(prev: number[], cur: number[]): boolean {
  if (prev.length === 0 || prev.length !== cur.length) return false
  let grew = false
  for (let i = 0; i < cur.length; i++) {
    if (cur[i] < prev[i]) return false
    if (cur[i] > prev[i]) grew = true
  }
  return grew
}

/** Whether a whole group of same-shape calls advances pairwise — every adjacent pair must grow, not just the last one. */
export function isAdvancingGroup(group: number[][]): boolean {
  if (group.length < 2) return false
  for (let i = 1; i < group.length; i++) {
    if (!isAdvancing(group[i - 1], group[i])) return false
  }
  return true
}

/** Find the longest string field in the arguments (the size/degeneration gates' subject). */
export function largestString(input: unknown): { path: string; value: string } {
  let best = { path: '', value: '' }
  const seen = new WeakSet<object>()
  const walk = (v: unknown, path: string): void => {
    if (typeof v === 'string') {
      if (v.length > best.value.length) best = { path, value: v }
      return
    }
    if (v === null || typeof v !== 'object') return
    if (seen.has(v)) return
    seen.add(v)
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`))
      return
    }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, path ? `${path}.${k}` : k)
  }
  try {
    walk(input, '')
  } catch {
    // Thousands-deep nesting throws RangeError. Swallowing it matters: an
    // escape would reject the tool call (the SDK's fail-safe for a throwing
    // handler) — a pure measurement accidentally blocking the tool with a
    // baffling reason. Whatever was scanned still returns.
  }
  return best
}

export function humanChars(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(2)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

// ---------------------------------------------------------------- extension

interface CallRecord {
  sig: string
  approx: string
  name: string
  chars: number
  ts: number
  nums: number[]
}

interface StreamState {
  chars: number
  buffer: string
  nextCheckAt: number
  aborted: boolean
}

export interface LoopGuardStats {
  calls: number
  warned: number
  blocked: number
  aborted: number
  maxArgChars: number
  maxArgTool: string
  turnChars: number
}

export interface PiLoopGuardOptions {
  /**
   * Where to read loop-guard.json. Production passes Cherry's pi root; tests
   * pass a temp file or rely on PI_LOOP_GUARD_CONFIG. Absent -> defaults +
   * env only.
   */
  configPath?: string
}

export function createPiLoopGuardExtension(options: PiLoopGuardOptions = {}): ExtensionFactory {
  return (pi) => {
    const cfg = loadConfig(process.env, options.configPath)
    let enabled = cfg.enabled
    const allow: RegExp[] = []
    for (const p of cfg.allowPatterns) {
      try {
        if (riskyPattern(p)) continue // ReDoS shapes never enter the gate
        allow.push(new RegExp(p))
      } catch {
        // Broken regexes are ignored; a config error must not take the gate offline.
      }
    }

    const stats: LoopGuardStats = {
      calls: 0,
      warned: 0,
      blocked: 0,
      aborted: 0,
      maxArgChars: 0,
      maxArgTool: '',
      turnChars: 0
    }
    let window: CallRecord[] = []
    let rate: number[] = []
    let stream: StreamState | null = null
    let blocksThisTurn = 0
    let warnedThisTurn = false
    let turnAborted = false
    // F: auto-continues spent this session (reset when the user speaks).
    let shellStopRetries = 0
    // A final sweep: auto-continues spent this session (same discipline).
    let streamRescueRetries = 0

    // Timing backstop for shapes the static audit cannot see. The FIRST freeze
    // still happens (synchronous regex cannot be interrupted) — this guarantees
    // it never repeats.
    const slowPatterns = new Set<number>()
    const isAllowed = (text: string): boolean => {
      if (!text) return false
      for (let i = 0; i < allow.length; i++) {
        if (slowPatterns.has(i)) continue
        const re = allow[i]
        try {
          const t0 = Date.now()
          const hit = re.test(text)
          if (Date.now() - t0 > SLOW_PATTERN_MS) {
            slowPatterns.add(i)
            logger.warn(`Loop-guard allow pattern /${re.source}/ exceeded ${SLOW_PATTERN_MS}ms and is disabled`)
          }
          if (hit) return true
        } catch {
          // `g`-flagged regexes carry lastIndex state; skip on failure.
        }
      }
      return false
    }

    const record = (kind: string, data: Record<string, unknown>): void => {
      try {
        pi.appendEntry('loop-guard', { kind, ts: Date.now(), ...data })
      } catch {
        // Trail failure must not affect the interception itself.
      }
    }

    const block = (
      ctx: ExtensionContext,
      layer: string,
      detail: Record<string, unknown>,
      reason: string,
      opts: { terminate?: boolean; abort?: boolean } = {}
    ): ToolCallEventResult => {
      stats.blocked++
      blocksThisTurn++
      const full = `loop-guard block (${layer}): ${reason}`
      record('block', { layer, ...detail })
      logger.warn(full)
      if (opts.abort || blocksThisTurn >= cfg.maxBlocksPerTurn) {
        abortTurn(ctx, layer, detail)
      }
      const out: ToolCallEventResult = { block: true, reason: full }
      if (opts.terminate || opts.abort || blocksThisTurn >= cfg.maxBlocksPerTurn) out.terminate = true
      return out
    }

    const abortTurn = (ctx: ExtensionContext, why: string, detail: Record<string, unknown>): void => {
      // Re-entry guard: the stream path sets stream.aborted first; never gate on that.
      if (turnAborted) return
      turnAborted = true
      stats.aborted++
      record('abort', { why, ...detail })
      logger.error(`Loop-guard aborted the turn (${why}). Waiting for the user.`)
      try {
        ctx.abort()
      } catch {
        // Aborting an idle session is a no-op.
      }
    }

    // ---------------- A gate: stream degeneration

    const newStream = (): StreamState => ({ chars: 0, buffer: '', nextCheckAt: cfg.streamCheckStep, aborted: false })

    /** Channel switches: the toolcall channel only runs A1 (legitimate file-write repetition dwarfs thinking/text). */
    const aSignalOpts = (kind: string): TailSignalOptions => {
      const prose = kind !== 'toolcall_delta'
      return {
        maxPeriod: cfg.streamRepeatMaxPeriod,
        minSuffix: cfg.streamRepeatMinSuffix,
        ratio: cfg.streamRepeatRatio,
        phraseMinPeriod: cfg.streamPhraseMinPeriod,
        phraseMaxPeriod: cfg.streamPhraseMaxPeriod,
        phraseCopies: cfg.streamPhraseCopies,
        phraseMinChars: cfg.streamPhraseMinChars,
        words: prose,
        wordRunMin: cfg.streamWordRunMin,
        wordFreqMin: cfg.streamWordFreqMin,
        wordShare: cfg.streamWordShare,
        lines: prose,
        lineMinChars: cfg.streamLineMinChars,
        lineRepeatMin: cfg.streamLineRepeatMin,
        lineGroupLines: cfg.streamLineGroupLines,
        lineGroupRepeat: cfg.streamLineGroupRepeat,
        phrase: prose,
        separatorsOk: !prose
      }
    }

    /** Trail fields: record every diagnostic of the hit signal so post-mortems need no guessing. */
    const verdictDetail = (v: TailVerdict, extra: Record<string, unknown>): Record<string, unknown> => ({
      ...extra,
      signal: v.signal,
      period: v.period,
      suffix: v.suffix,
      ratio: Number(v.ratio.toFixed(4)),
      unit: v.unit,
      token: v.token,
      run: v.run,
      freq: v.freq,
      share: Number(v.share.toFixed(3)),
      line: v.line,
      lineCount: v.lineCount,
      lineGroup: v.lineGroup
    })

    pi.on('message_start', (event: MessageStartEvent) => {
      if (event.message.role === 'assistant') stream = newStream()
    })

    pi.on('message_update', (event: MessageUpdateEvent, ctx) => {
      if (!enabled) return
      const ev = event.assistantMessageEvent as { type?: string; delta?: string }
      const kind = ev.type
      if (kind !== 'text_delta' && kind !== 'thinking_delta' && kind !== 'toolcall_delta') return
      const delta = ev.delta ?? ''
      if (!stream) stream = newStream()
      if (stream.aborted) return
      stream.chars += delta.length
      stream.buffer += delta
      // Keep twice the window; trim only when exceeded, so large buffers are
      // not re-copied every frame.
      if (stream.buffer.length > cfg.streamTailKeep * 2) stream.buffer = stream.buffer.slice(-cfg.streamTailKeep)

      if (stream.chars > cfg.streamHardMaxChars) {
        stream.aborted = true
        abortTurn(ctx, 'stream output exceeded the hard size cap', { channel: kind, chars: stream.chars })
        return
      }
      if (stream.chars < stream.nextCheckAt) return
      stream.nextCheckAt = stream.chars + cfg.streamCheckStep
      const tail = stream.buffer.slice(-cfg.streamTailKeep)
      const v = scanTail(tail, aSignalOpts(kind))
      if (v.signal) {
        stream.aborted = true
        abortTurn(
          ctx,
          signalLabel(v.signal),
          verdictDetail(v, { channel: kind, chars: stream.chars, window: tail.length })
        )
      }
    })

    pi.on('message_end', () => {
      stream = null
    })

    // ---------------- B/C/D/E gates: tool-call

    pi.on('tool_call', (event: ToolCallEvent, ctx): ToolCallEventResult | undefined => {
      if (!enabled) return
      const name = event.toolName ?? '?'
      const input = event.input ?? {}
      const text = stableStringify(input)
      const chars = text.length
      stats.calls++
      stats.turnChars += chars
      const big = largestString(input)
      if (big.value.length > stats.maxArgChars) {
        stats.maxArgChars = big.value.length
        stats.maxArgTool = name
      }

      // E1 rate gate
      const now = Date.now()
      rate = rate.filter((t) => now - t < 60000)
      rate.push(now)
      if (rate.length > cfg.rateAbortPerMinute) {
        return block(
          ctx,
          'rate',
          { tool: name, perMinute: rate.length },
          `${rate.length} tool calls in the last minute, past the abort threshold of ${cfg.rateAbortPerMinute}. Stop and report progress to the user.`,
          { terminate: true, abort: true }
        )
      }
      if (rate.length > cfg.ratePerMinute) {
        return block(
          ctx,
          'rate',
          { tool: name, perMinute: rate.length },
          `${rate.length} tool calls in the last minute, past the threshold of ${cfg.ratePerMinute}. Consolidate steps instead of probing one at a time.`,
          { terminate: true }
        )
      }

      // Argument degeneration is measured once, shared by B and C.
      const argDeg = degeneracy(big.value, {
        minChars: cfg.argRepeatMinChars,
        minSuffix: cfg.argRepeatMinChars,
        ratio: cfg.argRepeatRatio,
        maxPeriod: cfg.streamRepeatMaxPeriod
      })

      // B argument size gate
      if (big.value.length >= cfg.argBlockChars) {
        const why = argDeg.degenerate
          ? `argument ${big.path} is ${humanChars(big.value.length)} chars of period-${argDeg.period} repetition (${(argDeg.ratio * 100).toFixed(1)}% of it) — degenerate model output, not valid input`
          : `argument ${big.path} is ${humanChars(big.value.length)} chars, over the ${humanChars(cfg.argBlockChars)} cap`
        return block(
          ctx,
          'argument size',
          { tool: name, path: big.path, chars: big.value.length, degenerate: argDeg.degenerate, period: argDeg.period },
          `${why}. Split the input and retry; if the input is genuinely this large, ask the user to raise the cap or disable the guard.`,
          { terminate: true }
        )
      }
      // C argument degeneration gate (under the size cap, but stacked repetition)
      if (argDeg.degenerate) {
        return block(
          ctx,
          'argument degeneration',
          { tool: name, path: big.path, chars: big.value.length, period: argDeg.period, ratio: argDeg.ratio },
          `argument ${big.path} is ${humanChars(big.value.length)} chars, ${humanChars(argDeg.suffix)} of which is period-${argDeg.period} repetition (${(argDeg.ratio * 100).toFixed(1)}%) — an output loop leaked into the input. Stop and restructure the input.`,
          { terminate: true }
        )
      }

      // B warn (never blocks; at most once per turn to avoid spamming)
      if (big.value.length >= cfg.argWarnChars && !warnedThisTurn) {
        warnedThisTurn = true
        stats.warned++
        logger.warn(
          `Loop-guard: ${name} ${big.path} is ${humanChars(big.value.length)} chars (warn line ${humanChars(cfg.argWarnChars)})`
        )
        record('warn', { tool: name, path: big.path, chars: big.value.length })
      }

      // E2 per-turn budget gate
      if (stats.turnChars > cfg.turnArgBudgetChars) {
        return block(
          ctx,
          'turn budget',
          { tool: name, turnChars: stats.turnChars },
          `Cumulative tool arguments this turn reached ${humanChars(stats.turnChars)} chars, over the ${humanChars(cfg.turnArgBudgetChars)} budget. Stop, summarize progress, and let the user decide whether to continue.`,
          { terminate: true, abort: true }
        )
      }

      // D repeated-invocation gate
      const sig = toolSignature(name, input)
      const approx = approxSignature(name, input)
      const nums = extractNumbers(text)
      const exempt = isAllowed(big.value) || isAllowed(text.slice(0, 2000))
      window.push({ sig, approx, name, chars, ts: now, nums })
      if (window.length > cfg.windowSize) window = window.slice(-cfg.windowSize)
      if (exempt) {
        return
      }

      let consecutive = 0
      for (let i = window.length - 1; i >= 0; i--) {
        if (window[i].sig === sig) consecutive++
        else break
      }
      const inWindow = window.filter((r) => r.sig === sig).length
      const approxGroup = window.filter((r) => r.approx === approx)
      const approxInWindow = approxGroup.length
      // Pagination (read offsets, sequential files) differs only in numbers and
      // is not a loop — but only counts as pagination when the WHOLE group
      // advances; judging the last pair alone is fooled by an increasing tail.
      const advancing = isAdvancingGroup(approxGroup.map((r) => r.nums))

      const allowHint =
        'If this repetition is intentional (polling, periodic health checks), the user can exempt it via the allowPatterns list in loop-guard config, or disable the guard.'

      if (inWindow >= cfg.repeatWindowAbort) {
        return block(
          ctx,
          'repeated calls',
          { tool: name, sig, inWindow, consecutive, threshold: cfg.repeatWindowAbort, windowSize: window.length },
          `${name} with identical arguments appeared ${inWindow} times in the last ${window.length} calls, at the abort line of ${cfg.repeatWindowAbort}. Stop now and report where you are stuck. ${allowHint}`,
          { terminate: true, abort: true }
        )
      }
      if (consecutive >= cfg.repeatConsecutiveBlock || inWindow >= cfg.repeatWindowBlock) {
        const sample = big.value.slice(0, 160).replace(/\s+/g, ' ')
        return block(
          ctx,
          'repeated calls',
          {
            tool: name,
            sig,
            inWindow,
            consecutive,
            sample,
            thresholds: {
              consecutive: cfg.repeatConsecutiveBlock,
              window: cfg.repeatWindowBlock,
              abort: cfg.repeatWindowAbort
            },
            windowSize: window.length
          },
          `${name} with identical arguments ${
            consecutive >= cfg.repeatConsecutiveBlock
              ? `ran ${consecutive} times in a row`
              : `appeared ${inWindow} times in the last ${window.length} calls`
          } (block lines: ${cfg.repeatConsecutiveBlock} consecutive / ${cfg.repeatWindowBlock} in window; abort line ${cfg.repeatWindowAbort}; sample: ${sample}). Do not repeat the same call: read the previous result, change arguments or tools, and if a retry is genuinely needed, explain why to the user first. ${allowHint}`,
          { terminate: true }
        )
      }
      if (approxInWindow >= cfg.approxRepeatWindowBlock && !advancing) {
        return block(
          ctx,
          'approximate repeats',
          { tool: name, approx, approxInWindow, threshold: cfg.approxRepeatWindowBlock, windowSize: window.length },
          `${approxInWindow} of the last ${window.length} ${name} calls differ only in numbers with everything else identical, and the numbers do not advance monotonically (not pagination) — spinning in place (approximate block line ${cfg.approxRepeatWindowBlock}). Change strategy, or explain to the user what you are waiting for. ${allowHint}`,
          { terminate: true }
        )
      }
      return undefined
    })

    // ---------------- turn boundaries and state

    pi.on('before_agent_start', () => {
      // A new user turn: reset the per-turn budget and repeat window — the user
      // is entitled to re-run the same command.
      stats.turnChars = 0
      blocksThisTurn = 0
      warnedThisTurn = false
      turnAborted = false
      window = []
      rate = []
      stream = null
      shellStopRetries = 0
      streamRescueRetries = 0
    })

    pi.on('session_start', () => {
      stats.calls = 0
      stats.turnChars = 0
      blocksThisTurn = 0
      warnedThisTurn = false
      turnAborted = false
      window = []
      rate = []
      stream = null
      shellStopRetries = 0
      streamRescueRetries = 0
    })

    pi.on('turn_end', (event: TurnEndEvent): TurnEndEventResult | undefined => {
      stats.turnChars = 0
      blocksThisTurn = 0
      warnedThisTurn = false
      turnAborted = false
      // A disabled guard must be fully disabled: the A final sweep and the F
      // rescue below re-issue model requests, which still burns money.
      if (!enabled) return
      if (event.outcome && event.outcome !== 'completed') return
      const msg = event.message as { stopReason?: string; content?: unknown; provider?: string; model?: string }

      // ---- A final sweep: poison tails that slipped between streaming check
      // pulses (a stream can hide 1,024-1,536 chars of poison between two
      // pulses) get one last look before landing. On a hit: alert + trail; if
      // the whole message is essentially poisoned (share >= streamRescueRatio)
      // and the turn completed without tool calls, auto-continue once so the
      // model can restate itself (bounded by streamRescueMaxRetries, reset
      // when the user speaks).
      const body = assistantBodyText(msg)
      if (body) {
        const v = scanTail(body, aSignalOpts('text_delta'))
        if (v.signal) {
          const dominant =
            v.signal === 'wordrun' || v.signal === 'wordfreq'
              ? v.share >= cfg.streamRescueRatio
              : v.ratio >= cfg.streamRescueRatio
          const hasTool = (Array.isArray(msg.content) ? msg.content : []).some(
            (block) => (block as { type?: string })?.type === 'toolCall'
          )
          const sample = (v.unit || v.token || v.line || '').slice(0, 120)
          const stat =
            v.signal === 'wordrun' || v.signal === 'wordfreq'
              ? `word "${v.token}" x${v.run} (top frequency ${v.freq}, share ${(v.share * 100).toFixed(1)}%)`
              : v.signal === 'linefreq'
                ? `line "${v.line}" x${v.lineCount} (${(v.ratio * 100).toFixed(1)}% of the body)`
                : v.signal === 'linegroup'
                  ? `${v.lineGroup} distinct lines each repeated >=${cfg.streamLineGroupRepeat} times (sample: "${v.line}" x${v.lineCount})`
                  : `period ${v.period}, ${v.suffix}-char tail, ${(v.ratio * 100).toFixed(1)}% of the message`
          record(
            'detect',
            verdictDetail(v, {
              layer: 'stream degeneration',
              phase: 'turn_end',
              chars: body.length,
              dominant,
              retries: streamRescueRetries
            })
          )
          logger.error(
            `Loop-guard final sweep: the landed message contains ${signalLabel(v.signal)} (${stat}). Model output is poisoned.`
          )
          const rescuable = dominant && !hasTool && msg.stopReason === 'stop' && cfg.streamRescueMaxRetries > 0
          if (rescuable && streamRescueRetries < cfg.streamRescueMaxRetries) {
            streamRescueRetries++
            logger.warn(
              `Loop-guard: auto-continuing so the model can restate itself (${streamRescueRetries}/${cfg.streamRescueMaxRetries}).`
            )
            return {
              entries: [
                ...(event.entries ?? []),
                {
                  type: 'custom_message' as const,
                  customType: 'loop-guard-stream-degenerate',
                  content:
                    `Your previous reply's body/thinking degenerated into repetition (${signalLabel(v.signal)}: ${stat}). ` +
                    `This is output poisoning, not thinking. Reply directly with a concise conclusion or the next concrete step based on the original task: ` +
                    `do not describe what you intend to do, do not repeat what you already said, ` +
                    `and above all do not re-broadcast the repeated fragment (sample: ${sample || 'none'}).`,
                  display: false
                }
              ],
              continue: true
            }
          }
          if (rescuable && streamRescueRetries >= cfg.streamRescueMaxRetries) {
            logger.error(
              `Loop-guard: ${streamRescueRetries} consecutive degenerate messages; auto-continue disabled. Long context is a common trigger (consider compaction), or nudge the model manually.`
            )
            record('detect', {
              layer: 'stream degeneration',
              phase: 'turn_end',
              gave_up: true,
              retries: streamRescueRetries
            })
          }
        } else {
          // Clean finish: reset the rescue counter (the model recovered).
          streamRescueRetries = 0
        }
      }

      // F: shell tool-call stops. The model meant to call a tool but emitted
      // only close markers before stopping — pi sees "stop" and ends the turn,
      // both sides wait, and the session hangs on that frame (observed 9 times
      // in the source environment, each needing a manual nudge). Auto-continue
      // with a retry cap, so it cannot fight a model genuinely waiting for the
      // user.
      if (!cfg.shellStopGuard) return
      const verdict = detectShellStop(msg, cfg.shellStopMaxChars)
      if (!verdict.shell) {
        // Normal reply: reset the counter (real work finished this turn).
        shellStopRetries = 0
        return
      }
      if (shellStopRetries >= cfg.shellStopMaxRetries) {
        logger.error(
          `Loop-guard: ${shellStopRetries} consecutive empty tool-call shells (${verdict.markers} markers, no body); auto-continue disabled. Check the model/upstream adapter, or nudge manually.`
        )
        record('shell-stop', { markers: verdict.markers, retries: shellStopRetries, gave_up: true })
        return
      }
      shellStopRetries++
      const detail = `${msg.provider ?? '?'}/${msg.model ?? '?'} emitted ${verdict.markers} tool-call close markers with no call body and ended the turn`
      logger.warn(
        `Loop-guard: empty tool-call shell detected (${shellStopRetries}/${cfg.shellStopMaxRetries}): ${detail}. Auto-continuing.`
      )
      record('shell-stop', {
        markers: verdict.markers,
        retries: shellStopRetries,
        provider: msg.provider,
        model: msg.model
      })
      return {
        entries: [
          ...(event.entries ?? []),
          {
            type: 'custom_message' as const,
            customType: 'loop-guard-shell-stop',
            content:
              `Your previous reply emitted only tool-call close markers (${verdict.markers} of them, no body) and ended. ` +
              `You most likely intended a tool call but lost the call body during serialization. Re-issue that tool call in full; ` +
              `if there is genuinely no next step, state the current status and conclusion in a sentence or two instead.`,
            display: false
          }
        ],
        continue: true
      }
    })
  }
}
