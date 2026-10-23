import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { Sequencer } from '@shared/utils/async'

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

const EMOJI_PATTERN = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/u

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
    if (!EMOJI_PATTERN.test(match)) throw new Error('match must contain an emoji')
  } else if (/^[\p{L}\p{N}]+$/u.test(match)) {
    // A plain word would rewrite ordinary prose, not a face.
    throw new Error('kaomoji must contain at least one symbol')
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
        existing.zh = zh
        existing.en = en
        await this.persist()
        this.broadcast()
        return { rule: { ...existing }, updated: true }
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
      this.rules.push(rule)
      await this.persist()
      this.broadcast()
      return { rule: { ...rule }, updated: false }
    })
  }

  async remove(id: string): Promise<boolean> {
    return this.mutations.queue(async () => {
      const before = this.rules.length
      this.rules = this.rules.filter((rule) => rule.id !== id)
      if (this.rules.length === before) return false
      await this.persist()
      this.broadcast()
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

  private async persist(): Promise<void> {
    const temp = `${this.filePath}.tmp`
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    await fs.writeFile(temp, `${JSON.stringify(this.rules, null, 2)}\n`, 'utf8')
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
