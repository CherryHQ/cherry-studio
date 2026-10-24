import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { parse as parseHostname } from 'tldts-experimental'

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
    throw new Error(`Invalid domain: ${input}`)
  }
  // A public or private suffix would scope the rule to unrelated sites.
  if (parseHostname(domain, { allowPrivateDomains: true }).domain === null) {
    throw new Error(`Invalid domain: ${input}`)
  }
  return domain
}

/** True when `hostname` is `domain` itself or one of its subdomains. */
export function hostnameMatchesDomain(hostname: string, domain: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.+$/, '')
  return host === domain || host.endsWith(`.${domain}`)
}

/**
 * The scope a new rule may claim for a page: the page host itself or its
 * registrable domain. Public and private suffixes (`co.uk`, `github.io`) belong
 * to unrelated sites, so they are never a valid scope.
 */
export function isAllowedScope(hostname: string, domain: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.+$/, '')
  if (domain === host) return true
  const parsed = parseHostname(host, { allowPrivateDomains: true })
  return parsed.domain !== null && parsed.domain === domain
}

/** Option names Ghostery consumes as the request's source/target scope. */
const SCOPE_OPTION_PATTERN = /^\s*~?(?:domain|from|to)=/i

/**
 * The stored rule is always scoped to its saved `domain`. A rule that carries
 * its own scope option (`domain`, `from`, `to`, including negated forms) would
 * apply wherever that option points, so it is rejected instead of rewritten.
 */
function hasScopeOption(rule: string): boolean {
  const optionStart = rule.lastIndexOf('$')
  if (optionStart === -1) return false
  return rule
    .slice(optionStart + 1)
    .split(',')
    .some((option) => SCOPE_OPTION_PATTERN.test(option))
}

/**
 * Pins a network rule to the domain it was saved under. Returns `undefined` for
 * a rule that carries a scope option: validation rejects those, and compiling
 * one would let the filter escape its stored scope.
 */
export function scopeNetworkRule(value: string, domain: string): string | undefined {
  if (hasScopeOption(value)) return undefined
  return value.includes('$') ? `${value},domain=${domain}` : `${value}$domain=${domain}`
}

/**
 * Splits a selector list on top-level commas. Commas inside `:is(...)` or an
 * attribute value stay part of their selector.
 */
export function splitSelectors(value: string): string[] {
  const selectors: string[] = []
  let current = ''
  let square = 0
  let paren = 0
  let quote: string | undefined
  for (let index = 0; index < value.length; index++) {
    const char = value[index]
    if (quote) {
      current += char
      if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    if (char === '[') square++
    else if (char === ']') square--
    else if (char === '(') paren++
    else if (char === ')') paren--
    else if (char === ',' && square === 0 && paren === 0) {
      selectors.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  selectors.push(current.trim())
  return selectors.filter(Boolean)
}

/** Rejects selectors whose brackets, parentheses or quotes never close. */
function hasBalancedDelimiters(selector: string): boolean {
  let square = 0
  let paren = 0
  let quote: string | undefined
  for (const char of selector) {
    if (quote) {
      if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '[') square++
    else if (char === ']' && --square < 0) return false
    else if (char === '(') paren++
    else if (char === ')' && --paren < 0) return false
  }
  return square === 0 && paren === 0 && quote === undefined
}

/** Rejects a pseudo-class without a name, which invalidates its whole selector. */
function hasIncompletePseudo(selector: string): boolean {
  let quote: string | undefined
  for (let index = 0; index < selector.length; index++) {
    const char = selector[index]
    if (quote) {
      if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char !== ':') continue
    let next = selector[index + 1]
    if (next === ':') next = selector[++index + 1]
    if (!next || !/[a-zA-Z_-]/.test(next)) return true
  }
  return false
}

function validateCosmeticSelector(value: string): string {
  const selector = value.trim()
  if (!selector) throw new Error('CSS selector must not be empty')
  if (selector.length > MAX_VALUE_LENGTH) throw new Error(`CSS selector must be at most ${MAX_VALUE_LENGTH} characters`)
  if (!CSS_SELECTOR_PATTERN.test(selector)) {
    throw new Error('CSS selector contains disallowed characters; pass the selector only, not declarations')
  }
  // A selector that starts with a combinator or ends with one would be parsed
  // as a relative selector by some engines; reject instead of guessing.
  if (/^[>+~]/.test(selector)) throw new Error('CSS selector must not start with a combinator')
  if (splitSelectors(selector).some((part) => !hasBalancedDelimiters(part) || hasIncompletePseudo(part))) {
    throw new Error('CSS selector is malformed; check brackets, parentheses and pseudo-classes')
  }
  return selector
}

function validateNetworkRule(value: string): string {
  const rule = value.trim()
  if (!rule) throw new Error('Network rule must not be empty')
  if (rule.length > MAX_VALUE_LENGTH) throw new Error(`Network rule must be at most ${MAX_VALUE_LENGTH} characters`)
  if (FORBIDDEN_NETWORK_MARKERS.some((marker) => rule.includes(marker))) {
    throw new Error('Network rule must not contain element-hiding syntax; use the css field')
  }
  if (/\s/.test(rule)) throw new Error('Network rule must not contain whitespace')
  if (!/^(@@)?[|/]/.test(rule)) {
    throw new Error('Network rule must start with ||, | or /')
  }
  if (hasScopeOption(rule)) {
    throw new Error('Network rule must not carry a domain, from or to option; the domain argument sets the scope')
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
        throw new Error(`Rule limit reached (${MAX_RULES}); delete some rules in Settings first`)
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
