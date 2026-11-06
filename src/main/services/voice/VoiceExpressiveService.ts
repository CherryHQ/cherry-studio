import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { Sequencer } from '@shared/utils/async'
import { COMPLETE_EMOJI_SEQUENCE } from '@shared/utils/emojiSequence'

const logger = loggerService.withContext('VoiceExpressive')

export type ExpressiveRuleKind = 'emoji' | 'kaomoji'
export type ExpressiveRuleSource = 'ai' | 'manual'

export interface ExpressiveRule {
  id: string
  kind: ExpressiveRuleKind
  /** The emoji character or the kaomoji string this label replaces. */
  match: string
  zh: string
  en: string
  source: ExpressiveRuleSource
  createdAt: number
}

export interface SetExpressiveRuleInput {
  kind: ExpressiveRuleKind
  match: string
  zh: string
  en: string
  source?: ExpressiveRuleSource
}

const MAX_MATCH_LENGTH = 32
const MAX_LABEL_LENGTH = 40
const MAX_RULES = 500

/** Bracketed faces, optionally followed by a question or exclamation mark. */
const BRACKETED_KAOMOJI = /^[(（[［{｛<＜]([\s\S]*)[)）\]］}｝>＞][?？!！]*$/u
/** Western faces read as eye, mouth mark, eye (`T_T`, `o_o`, `>_<`). */
const EYE_MOUTH_EYE = /^[oO0xX^><:;'\-TtUuVv][_\-~.^,][oO0xX^><:;'\-TtUuVv]$/u
const MOUTH_MARK = /[_\-~.^,]/
/**
 * Glyphs that appear in faces but not in ordinary prose. ASCII marks such as
 * `@`, `^` and `*` are deliberately absent: on their own they are ordinary
 * punctuation (and an `@` can sit inside an email address), so they only count
 * as part of a mirrored or eye-mouth-eye face.
 */
const KAOMOJI_GLYPHS = '＾▽￣︶・°□¬＠´｀๑و✧づツᴗง︵┻━益εू༎ຶ⁍⁌ಠಥ⌒ω○●◕◔ヽノﾉヾゞ٩۶♪♡ʖᴥ﹏ﾟ｡･◡‿¯'
/** ASCII eye marks that can frame a mirrored face such as `@_@` or `*^_^*`. */
const MIRRORED_EYES = /[oO0xX^><:;'\-@*]/

function hasKaomojiGlyph(value: string): boolean {
  for (const char of value) if (KAOMOJI_GLYPHS.includes(char)) return true
  return false
}

const ASCII_ALNUM = /[A-Za-z0-9]/

function isMirroredCore(core: string): boolean {
  const chars = [...core]
  if (chars.length !== 3 || chars[0] !== chars[2] || ASCII_ALNUM.test(chars[0])) return false
  return MOUTH_MARK.test(chars[1]) || /[oO0]/.test(chars[1])
}

function faceCore(core: string): boolean {
  const trimmed = core.trim()
  if ([...trimmed].length < 2) return false
  if (EYE_MOUTH_EYE.test(trimmed) || isMirroredCore(trimmed)) return true
  // One glyph inside otherwise ordinary text is not a face: `(20°C)` contains
  // `°` but must not become a persistent substitution for temperatures.
  if (ASCII_ALNUM.test(trimmed)) return false
  return hasKaomojiGlyph(trimmed)
}

/**
 * Unbracketed faces must mirror their outer mark (`@_@`, `ಠ益ಠ`,
 * `¯\_(ツ)_/¯`). A bare mark, an email address or another ordinary token does
 * not, so it cannot become a persistent global substitution.
 */
function isMirroredFace(match: string): boolean {
  const chars = [...match]
  if (chars.length < 3) return false
  const first = chars[0]
  if (first !== chars[chars.length - 1]) return false
  if (!hasKaomojiGlyph(first) && !MIRRORED_EYES.test(first)) return false
  const inner = chars.slice(1, -1)
  if (inner.length === 1) return hasKaomojiGlyph(first) || MOUTH_MARK.test(inner[0])
  return inner.some((char) => MOUTH_MARK.test(char))
}

/** Rejects punctuation and prose tokens that only look like a kaomoji. */
function looksLikeKaomoji(match: string): boolean {
  const bracketed = BRACKETED_KAOMOJI.exec(match)
  if (bracketed) return faceCore(bracketed[1])
  if (EYE_MOUTH_EYE.test(match)) return true
  return isMirroredFace(match)
}

function normalizeLabel(value: string, field: 'zh' | 'en'): string {
  const label = value.trim().replace(/\s+/g, ' ')
  if (!label) throw new Error(`${field} label must not be empty`)
  if (label.length > MAX_LABEL_LENGTH) {
    throw new Error(`${field} label must be at most ${MAX_LABEL_LENGTH} characters`)
  }
  return label
}

function normalizeMatch(input: SetExpressiveRuleInput): string {
  const match = input.match.trim()
  if (!match) throw new Error('match must not be empty')
  if (match.length > MAX_MATCH_LENGTH) throw new Error(`match must be at most ${MAX_MATCH_LENGTH} characters`)
  if (/\s/.test(match)) throw new Error('match must not contain whitespace')

  if (input.kind === 'emoji') {
    if (!COMPLETE_EMOJI_SEQUENCE.test(match)) throw new Error('match must be one complete emoji sequence')
  } else if (/^[\p{L}\p{N}]+$/u.test(match) && !hasKaomojiGlyph(match)) {
    // A plain word would rewrite ordinary prose, not a face. Letter-only faces
    // such as `ಠ益ಠ` still carry a face glyph and fall through to the shape check.
    throw new Error('kaomoji must contain at least one symbol')
  } else if (!looksLikeKaomoji(match)) {
    throw new Error('kaomoji must look like a face, not ordinary text')
  }
  return match
}

/**
 * Custom labels for emoji and kaomoji that the built-in table does not cover.
 *
 * The renderer owns the rewrite, so this service only persists rules and
 * broadcasts them; `expressiveText` applies the newest list the moment it
 * arrives. Agents call `voice_expressive` to add or remove entries.
 */
@Injectable('VoiceExpressiveService')
@ServicePhase(Phase.WhenReady)
export class VoiceExpressiveService extends BaseService {
  private rules: ExpressiveRule[] = []
  private loaded = false
  private filePath = ''
  private readonly mutations = new Sequencer()

  protected async onInit(): Promise<void> {
    this.filePath = application.getPath('feature.voice.expressive_file')
    await this.load()
  }

  list(): ExpressiveRule[] {
    return this.rules.map((rule) => ({ ...rule }))
  }

  async set(input: SetExpressiveRuleInput): Promise<{ rule: ExpressiveRule; updated: boolean }> {
    const kind = input.kind
    const match = normalizeMatch(input)
    const zh = normalizeLabel(input.zh, 'zh')
    const en = normalizeLabel(input.en, 'en')

    return this.mutations.queue(async () => {
      const existing = this.rules.find((rule) => rule.kind === kind && rule.match === match)
      if (existing) {
        const updated = { ...existing, zh, en }
        const candidate = this.rules.map((rule) => (rule === existing ? updated : rule))
        await this.commit(candidate)
        return { rule: { ...updated }, updated: true }
      }
      if (this.rules.length >= MAX_RULES) {
        throw new Error(`Rule limit reached (${MAX_RULES}); remove some rules first`)
      }
      const rule: ExpressiveRule = {
        id: randomUUID(),
        kind,
        match,
        zh,
        en,
        source: input.source ?? 'manual',
        createdAt: Date.now()
      }
      await this.commit([...this.rules, rule])
      return { rule: { ...rule }, updated: false }
    })
  }

  async remove(id: string): Promise<boolean> {
    return this.mutations.queue(async () => {
      const candidate = this.rules.filter((rule) => rule.id !== id)
      if (candidate.length === this.rules.length) return false
      await this.commit(candidate)
      return true
    })
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) throw new Error('rule file must contain an array')
      this.rules = parsed.flatMap((entry) => {
        try {
          const rule = entry as ExpressiveRule
          return [
            {
              ...rule,
              id: typeof rule.id === 'string' && rule.id ? rule.id : randomUUID(),
              zh: normalizeLabel(rule.zh, 'zh'),
              en: normalizeLabel(rule.en, 'en'),
              match: normalizeMatch(rule),
              source: rule.source === 'ai' ? 'ai' : 'manual',
              createdAt: Number.isFinite(rule.createdAt) ? rule.createdAt : Date.now()
            }
          ]
        } catch (error) {
          logger.warn('Skipping invalid expressive rule', { error })
          return []
        }
      })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') logger.warn('Failed to read expressive rules', { error })
      this.rules = []
    }
  }

  /**
   * Writes the candidate first and adopts it only on success: a rejected
   * mutation must not linger in memory and ride along with the next save.
   */
  private async commit(candidate: ExpressiveRule[]): Promise<void> {
    await this.persist(candidate)
    this.rules = candidate
    this.broadcast()
  }

  private async persist(rules: readonly ExpressiveRule[]): Promise<void> {
    const temp = `${this.filePath}.tmp`
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    await fs.writeFile(temp, `${JSON.stringify(rules, null, 2)}\n`, 'utf8')
    await fs.rename(temp, this.filePath)
  }

  private broadcast(): void {
    try {
      application.get('IpcApiService').broadcast('voice.expressive.changed', this.list())
    } catch (error) {
      logger.debug('Failed to broadcast expressive rules', { error })
    }
  }
}
