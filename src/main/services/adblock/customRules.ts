import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { Sequencer } from '@shared/utils/async'

const logger = loggerService.withContext('AdblockRules')

export type CustomAdblockRuleKind = 'cosmetic' | 'network'
export type CustomAdblockRuleSource = 'ai' | 'manual'

export interface CustomAdblockRule {
  id: string
  /** Exact host or registrable domain; subdomains are included. */
  domain: string
  kind: CustomAdblockRuleKind
  /** CSS selector for `cosmetic`, Adblock network rule for `network`. */
  value: string
  note: string
  source: CustomAdblockRuleSource
  enabled: boolean
  createdAt: number
}

export interface NewCustomAdblockRule {
  domain: string
  kind: CustomAdblockRuleKind
  value: string
  note?: string
  source?: CustomAdblockRuleSource
}

const MAX_VALUE_LENGTH = 500
const MAX_NOTE_LENGTH = 200
/** A runaway agent should stop at a size a human can still audit. */
const MAX_RULES = 500
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i
/** Characters a CSS selector may contain. Braces, semicolons and angle brackets would escape the rule. */
const CSS_SELECTOR_PATTERN = /^[\w\s#.:[\]="'*^$|()!+,>~-]+$/
const FORBIDDEN_NETWORK_MARKERS = ['##', '#@#', '#?#', '#$#', '\n', '\r']

export function normalizeDomain(input: string): string {
  const domain = input.trim().toLowerCase().replace(/^\.+/, '').replace(/\.+$/, '')
  if (!DOMAIN_PATTERN.test(domain)) {
    throw new Error(`无效域名：${input}`)
  }
  return domain
}

/** True when `hostname` is `domain` itself or one of its subdomains. */
export function hostnameMatchesDomain(hostname: string, domain: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.+$/, '')
  return host === domain || host.endsWith(`.${domain}`)
}

/**
 * The stored rule is always scoped to its saved `domain`. A rule that carries
 * its own `domain=` option would apply wherever that option points, so it is
 * rejected instead of being silently rewritten.
 */
function hasDomainOption(rule: string): boolean {
  const optionStart = rule.lastIndexOf('$')
  if (optionStart === -1) return false
  return rule
    .slice(optionStart + 1)
    .split(',')
    .some((option) => /^\s*domain=/i.test(option))
}

/**
 * Pins a network rule to the domain it was saved under. Returns `undefined` for
 * a rule that carries its own `domain=` option: validation rejects those, and
 * compiling one would let the filter escape its stored scope.
 */
export function scopeNetworkRule(value: string, domain: string): string | undefined {
  if (hasDomainOption(value)) return undefined
  return value.includes('$') ? `${value},domain=${domain}` : `${value}$domain=${domain}`
}

function validateCosmeticSelector(value: string): string {
  const selector = value.trim()
  if (!selector) throw new Error('CSS 选择器不能为空')
  if (selector.length > MAX_VALUE_LENGTH) throw new Error(`CSS 选择器不能超过 ${MAX_VALUE_LENGTH} 个字符`)
  if (!CSS_SELECTOR_PATTERN.test(selector)) {
    throw new Error('CSS 选择器包含不允许的字符，只能写选择器本身，不能带样式声明')
  }
  // A selector that starts with a combinator or ends with one would be parsed
  // as a relative selector by some engines; reject instead of guessing.
  if (/^[>+~]/.test(selector)) throw new Error('CSS 选择器不能以组合符开头')
  return selector
}

function validateNetworkRule(value: string): string {
  const rule = value.trim()
  if (!rule) throw new Error('网络规则不能为空')
  if (rule.length > MAX_VALUE_LENGTH) throw new Error(`网络规则不能超过 ${MAX_VALUE_LENGTH} 个字符`)
  if (FORBIDDEN_NETWORK_MARKERS.some((marker) => rule.includes(marker))) {
    throw new Error('网络规则不能包含元素隐藏语法，隐藏元素请用 css 参数')
  }
  if (/\s/.test(rule)) throw new Error('网络规则不能包含空白字符')
  if (!/^(@@)?[|/]/.test(rule)) {
    throw new Error('网络规则必须以 ||、| 或 / 开头')
  }
  if (hasDomainOption(rule)) {
    throw new Error('网络规则不能自带 domain 选项，作用域由 domain 参数决定')
  }
  return rule
}

export function validateRuleInput(input: NewCustomAdblockRule): NewCustomAdblockRule {
  return {
    ...input,
    domain: normalizeDomain(input.domain),
    value: input.kind === 'cosmetic' ? validateCosmeticSelector(input.value) : validateNetworkRule(input.value),
    note: (input.note ?? '').trim().slice(0, MAX_NOTE_LENGTH),
    source: input.source ?? 'manual'
  }
}

/**
 * Rules the AI writes through the browser tool, plus anything a user adds by
 * hand. Small enough that a JSON file beats a database table: the whole set is
 * read once at startup and rewritten on every change.
 */
export class CustomAdblockRuleStore {
  private rules: CustomAdblockRule[] = []
  private loaded = false
  private readonly filePath: string
  /** Mutation and persistence travel together, so concurrent callers cannot interleave writes. */
  private readonly mutations = new Sequencer()

  constructor(filePath: string) {
    this.filePath = filePath
  }

  async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) throw new Error('rule file must contain an array')
      this.rules = parsed.flatMap((entry) => {
        try {
          const rule = entry as CustomAdblockRule
          const validated = validateRuleInput(rule)
          return [
            {
              ...validated,
              id: typeof rule.id === 'string' && rule.id ? rule.id : randomUUID(),
              enabled: rule.enabled !== false,
              createdAt: Number.isFinite(rule.createdAt) ? rule.createdAt : Date.now(),
              note: validated.note ?? '',
              source: validated.source ?? 'manual'
            }
          ]
        } catch (error) {
          logger.warn('Skipping invalid adblock rule', { error })
          return []
        }
      })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') logger.warn('Failed to read adblock rules', { error })
      this.rules = []
    }
  }

  list(): CustomAdblockRule[] {
    return this.rules.map((rule) => ({ ...rule }))
  }

  async add(input: NewCustomAdblockRule): Promise<{ rule: CustomAdblockRule; existing: boolean }> {
    const validated = validateRuleInput(input)
    return this.mutations.queue(async () => {
      const existing = this.rules.find(
        (rule) => rule.domain === validated.domain && rule.kind === validated.kind && rule.value === validated.value
      )
      if (existing) {
        existing.enabled = true
        existing.note = validated.note ?? existing.note
        await this.persist()
        return { rule: { ...existing }, existing: true }
      }
      if (this.rules.length >= MAX_RULES) {
        throw new Error(`规则数量已达上限（${MAX_RULES} 条），请先在设置里清理`)
      }
      const rule: CustomAdblockRule = {
        id: randomUUID(),
        domain: validated.domain,
        kind: validated.kind,
        value: validated.value,
        note: validated.note ?? '',
        source: validated.source ?? 'manual',
        enabled: true,
        createdAt: Date.now()
      }
      this.rules.push(rule)
      await this.persist()
      return { rule: { ...rule }, existing: false }
    })
  }

  async remove(id: string): Promise<boolean> {
    return this.mutations.queue(async () => {
      const before = this.rules.length
      this.rules = this.rules.filter((rule) => rule.id !== id)
      if (this.rules.length === before) return false
      await this.persist()
      return true
    })
  }

  async setEnabled(id: string, enabled: boolean): Promise<CustomAdblockRule | undefined> {
    return this.mutations.queue(async () => {
      const rule = this.rules.find((entry) => entry.id === id)
      if (!rule) return undefined
      rule.enabled = enabled
      await this.persist()
      return { ...rule }
    })
  }

  private async persist(): Promise<void> {
    const temp = `${this.filePath}.tmp`
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    await fs.writeFile(temp, `${JSON.stringify(this.rules, null, 2)}\n`, 'utf8')
    await fs.rename(temp, this.filePath)
  }
}
