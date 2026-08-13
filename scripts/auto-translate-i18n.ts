/**
 * Translation of every locale except the base one.
 *
 * Source text always comes from the base locale by full key path and the `[to be translated]`
 * marker never enters model input, so nothing can echo or retranslate it. Every reply is
 * validated deterministically before it is written: a translation that loses an interpolation
 * variable, a component tag or a `$t()` reference is dropped and its placeholder kept, and the
 * run exits non-zero.
 *
 * Translation itself is one batched request per locale carrying the full key path, the zh-cn
 * reference, the glossary and style examples from the same namespaces. `--translator` picks who
 * answers it, and `--research` optionally prepends a tool-enabled Claude Agent SDK pass that reads
 * the codebase for what renders each key. The two are independent so their effects stay separable.
 *
 * Usage: pnpm i18n:translate [--locale <code>] [--translator endpoint|claude] [--research] [--dry-run]
 */
import { type Options, query } from '@anthropic-ai/claude-agent-sdk'
import { OpenAI } from '@cherrystudio/openai'
import * as fs from 'fs'
import * as path from 'path'

import { sortedObjectByKeys } from './sort'

type I18NValue = string | { [key: string]: I18NValue }
type I18N = { [key: string]: I18NValue }

type PendingKey = { scope: string; key: string; english: string; zhCn?: string }
type Brief = { key: string; uiRole: string; meaning: string; tone: string; lengthHint: string; usage: string }
type StyleExample = { english: string; translation: string }
type Target = {
  filePath: string
  locale: string
  scope: string
  json: I18N
  pending: PendingKey[]
  style: StyleExample[]
}
type Glossary = { doNotTranslate: string[]; terms: Record<string, Record<string, string>> }

const MARKER = '[to be translated]'
const ROOT = path.resolve(__dirname, '..')
const BASE_LOCALE = process.env.TRANSLATION_BASE_LOCALE ?? 'en-us'
const DIRECT_MODEL = process.env.TRANSLATION_MODEL ?? 'deepseek/deepseek-v4-flash'
const DIRECT_BASE_URL = process.env.TRANSLATION_BASE_URL ?? 'https://api.ppinfra.com/openai/v1'
const RESEARCH_MODEL = process.env.I18N_RESEARCH_MODEL ?? 'claude-sonnet-5'
const CLAUDE_TRANSLATE_MODEL = process.env.I18N_TRANSLATE_MODEL ?? 'claude-sonnet-5'
const BATCH_SIZE = 50
const CONCURRENCY = 3

const flagValue = (name: string, fallback: string) => {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1]
}

// Two independent switches, so "does research help?" can be measured without also changing model.
const RESEARCH = process.argv.includes('--research') || process.env.I18N_RESEARCH === 'true'
const TRANSLATOR = flagValue('--translator', process.env.I18N_TRANSLATOR ?? 'endpoint')
if (TRANSLATOR !== 'endpoint' && TRANSLATOR !== 'claude') {
  throw new Error(`unknown translator "${TRANSLATOR}", expected "endpoint" or "claude"`)
}

/** Wall-clock and spend, reported per run so the two engines stay comparable. */
const stats = { costUsd: 0, inputTokens: 0, outputTokens: 0, requests: 0 }

// Renderer and main each own an independent catalog (locales/ + translate/); translate both.
const CATALOGS = [
  { scope: 'renderer', dir: 'src/renderer/i18n' },
  { scope: 'main', dir: 'src/main/i18n' }
]

const LANGUAGE_NAMES: Record<string, string> = {
  'zh-cn': 'Simplified Chinese',
  'zh-tw': 'Traditional Chinese',
  'ja-jp': 'Japanese',
  'ru-ru': 'Russian',
  'el-gr': 'Greek',
  'es-es': 'Spanish',
  'fr-fr': 'French',
  'pt-pt': 'Portuguese',
  'de-de': 'German',
  'ro-ro': 'Romanian',
  'vi-vn': 'Vietnamese'
}

// ---------------------------------------------------------------- json helpers

const flatten = (obj: I18N, prefix = '', out: Record<string, string> = {}): Record<string, string> => {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') {
      out[fullKey] = value
    } else if (value !== null && typeof value === 'object') {
      flatten(value, fullKey, out)
    }
  }
  return out
}

const setAt = (obj: I18N, key: string, value: string): void => {
  const parts = key.split('.')
  let cursor = obj
  for (const part of parts.slice(0, -1)) {
    cursor = cursor[part] as I18N
  }
  cursor[parts[parts.length - 1]] = value
}

const readJson = (filePath: string): I18N => JSON.parse(fs.readFileSync(filePath, 'utf-8'))

const mapPool = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await fn(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

// ------------------------------------------------------------------ validation

const interpolations = (text: string) => (text.match(/{{[^}]*}}/g) ?? []).sort()
// `<Trans>` in this codebase uses named component tags (`<provider>`, `<link>`), never numeric ones.
const tagPlaceholders = (text: string) => (text.match(/<\/?[\w-]+\s*\/?>/g) ?? []).sort()
const nestedKeys = (text: string) => (text.match(/\$t\([^)]*\)/g) ?? []).sort()

/** Case and separators vary legitimately: "Github", "Cherry-Studio-Diagnose". Spelling does not. */
const foldForTermMatch = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

/**
 * Returns a rejection reason, or null when the translation is safe to write.
 *
 * Every rule corresponds to a failure this pipeline has actually shipped, and each one is
 * checked against the whole existing catalog (see the test) — a rule that rejects a correct
 * translation strands that key on its placeholder forever, which is worse than what it prevents.
 */
export const validate = (english: string, translation: string, doNotTranslate: string[] = []): string | null => {
  const text = translation.trim()

  // A base string that is only punctuation ("." as a sentence terminator) may translate to nothing.
  if (!text) return /[\p{L}\p{N}]/u.test(english) ? 'empty' : null
  if (/to be translated/i.test(text)) return 'placeholder marker leaked into the translation'
  if (text.startsWith('[') && !english.trim().startsWith('['))
    return 'starts with a bracketed note instead of the translation'
  if (text.length > Math.max(80, english.length * 4))
    return 'suspiciously long — likely an explanation, not a translation'

  const sameList = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b)
  if (!sameList(interpolations(english), interpolations(translation))) {
    return `interpolation mismatch: expected ${interpolations(english).join(' ') || '(none)'}`
  }
  if (!sameList(tagPlaceholders(english), tagPlaceholders(translation))) {
    return `tag placeholder mismatch: expected ${tagPlaceholders(english).join(' ') || '(none)'}`
  }
  if (!sameList(nestedKeys(english), nestedKeys(translation))) {
    return `$t() reference mismatch: expected ${nestedKeys(english).join(' ') || '(none)'}`
  }

  const foldedTranslation = foldForTermMatch(text)
  for (const term of doNotTranslate) {
    if (english.includes(term) && !foldedTranslation.includes(foldForTermMatch(term))) {
      return `dropped untranslatable term "${term}"`
    }
  }

  return null
}

// ----------------------------------------------------------------- agent calls

const runQuery = async <T>(prompt: string, options: Options): Promise<T> => {
  for await (const message of query({ prompt, options })) {
    if (message.type !== 'result') continue
    stats.requests += 1
    stats.costUsd += message.total_cost_usd ?? 0
    stats.inputTokens += message.usage?.input_tokens ?? 0
    stats.outputTokens += message.usage?.output_tokens ?? 0
    if (message.subtype !== 'success') {
      throw new Error(`agent run failed: ${message.subtype}`)
    }
    if (!message.structured_output) {
      throw new Error('agent returned no structured output')
    }
    return message.structured_output as T
  }
  throw new Error('agent stream ended without a result')
}

const BRIEF_SCHEMA = {
  type: 'object',
  properties: {
    briefs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          uiRole: { type: 'string', description: 'button | label | tooltip | modal title | toast | error | ...' },
          meaning: { type: 'string', description: 'What the string tells the user, with ambiguous terms resolved' },
          tone: { type: 'string' },
          lengthHint: { type: 'string', description: 'tight | moderate | free' },
          usage: { type: 'string', description: 'file:line of a real usage, or "not found"' }
        },
        required: ['key', 'uiRole', 'meaning', 'tone', 'lengthHint', 'usage']
      }
    }
  },
  required: ['briefs']
}

const RESEARCH_PROMPT = `You are researching UI strings in the Cherry Studio codebase (an Electron desktop AI client) so that translators can render them correctly in other languages.

For each key below, find where it is used and describe what the string actually is in the product.

- Renderer UI strings live under src/renderer, main-process strings under src/main.
- Grep for the full key path. Keys appear as t('<key>'), i18n.t('<key>'), <Trans i18nKey="<key>">, or in props like titleKey / labelKey / messageKey.
- Read enough of the surrounding code to tell which UI element renders the string (button, menu item, settings label, tooltip, modal title, toast, inline error, table header, empty state) and what the user is doing at that moment.
- Sibling keys under the same namespace tell you which panel or flow the string belongs to.
- If a key has no usage yet, say "not found" and infer from the key path and its siblings.

lengthHint: "tight" for buttons, menu items and labels that sit in a fixed-width control; "moderate" for titles and short hints; "free" for descriptions and paragraphs.

`

const research = async (keys: PendingKey[]): Promise<Map<string, Brief>> => {
  const batches: { scope: string; keys: PendingKey[] }[] = []
  for (const scope of new Set(keys.map((key) => key.scope))) {
    const scoped = keys.filter((key) => key.scope === scope)
    for (let i = 0; i < scoped.length; i += BATCH_SIZE) {
      batches.push({ scope, keys: scoped.slice(i, i + BATCH_SIZE) })
    }
  }

  const briefs = new Map<string, Brief>()
  const results = await mapPool(batches, CONCURRENCY, async ({ scope, keys: batch }) => {
    const list = batch.map(({ key, english }) => `- ${key} = ${JSON.stringify(english)}`).join('\n')
    const header = `These keys belong to the ${scope}-process catalog, so their usages are under src/${scope}.\n\nKeys to research:\n`
    return runQuery<{ briefs: Brief[] }>(RESEARCH_PROMPT + header + list, {
      model: RESEARCH_MODEL,
      cwd: ROOT,
      settingSources: [],
      allowedTools: ['Grep', 'Glob', 'Read'],
      permissionMode: 'dontAsk',
      maxTurns: 80,
      outputFormat: { type: 'json_schema', schema: BRIEF_SCHEMA }
    })
  })

  for (const [index, result] of results.entries()) {
    for (const brief of result.briefs ?? []) {
      briefs.set(`${batches[index].scope}:${brief.key}`, brief)
    }
  }
  return briefs
}

const TRANSLATION_SCHEMA = {
  type: 'object',
  properties: {
    translations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          text: { type: 'string' }
        },
        required: ['key', 'text']
      }
    }
  },
  required: ['translations']
}

const translatePrompt = (
  locale: string,
  glossary: Glossary,
  items: unknown[],
  briefed: boolean,
  style: StyleExample[]
): string => {
  const pins = Object.entries(glossary.terms)
    .map(([term, entry]) => {
      const pinned = entry[locale]
      const note = entry.note ? ` (${entry.note})` : ''
      return pinned ? `- "${term}" → "${pinned}"${note}` : `- "${term}"${note}`
    })
    .join('\n')

  const situation = briefed
    ? 'Each string below comes with a brief describing where it appears in the UI — translate for that situation, not for the sentence in isolation.'
    : 'Each string below comes with its full i18n key path, which tells you which screen and which kind of control it belongs to — translate for that situation, not for the sentence in isolation.'

  return `Translate Cherry Studio UI strings from English into ${LANGUAGE_NAMES[locale]}.

Cherry Studio is a desktop AI chat client. ${situation}

Rules:
- Return only the translated string. No explanations, no bracketed notes, no quotes around the result.
- Copy every {{variable}} through unchanged. Never translate or rename the text inside {{ }}, never drop one, and never substitute the value it stands for.
- Copy every tag placeholder and $t(...) reference through unchanged, including named ones such as <provider>...</provider>, <link>...</link>, <strong>...</strong> and <INPUT>...</INPUT>. They wrap the text in a link or other component at runtime, so translate what is between the tags and never rename, reorder away or drop the tags themselves.
- Keep these verbatim in Latin script: ${glossary.doNotTranslate.join(', ')}.
- Keep button, menu and label strings roughly as short as the English, because they sit in fixed-width controls.${briefed ? ' Follow lengthHint when it says "tight".' : ''}
- Use the established terminology below. Inflect it as the target language requires, but do not switch to a synonym.
- zhCn is a human-reviewed translation of the same string. Use it to resolve ambiguity in the English; do not translate from it.
- Match the register, politeness level and punctuation of the existing translations shown below. They come from this same catalog, so following them keeps the UI consistent.

Terminology:
${pins}
${style.length ? `\nExisting translations from this catalog:\n${style.map((e) => `- ${JSON.stringify(e.english)} → ${JSON.stringify(e.translation)}`).join('\n')}\n` : ''}
Strings:
${JSON.stringify(items, null, 2)}
`
}

const toTranslationMap = (translations: { key: string; text: string }[] | undefined) =>
  new Map((translations ?? []).map(({ key, text }) => [key, text]))

const translateViaAgent = async (locale: string, glossary: Glossary, items: unknown[], style: StyleExample[]) => {
  const briefed = RESEARCH
  const result = await runQuery<{ translations: { key: string; text: string }[] }>(
    translatePrompt(locale, glossary, items, briefed, style),
    {
      model: CLAUDE_TRANSLATE_MODEL,
      cwd: ROOT,
      settingSources: [],
      allowedTools: [],
      permissionMode: 'dontAsk',
      maxTurns: 2,
      outputFormat: { type: 'json_schema', schema: TRANSLATION_SCHEMA }
    }
  )
  return toTranslationMap(result.translations)
}

let openai: OpenAI | undefined
const translateViaEndpoint = async (locale: string, glossary: Glossary, items: unknown[], style: StyleExample[]) => {
  openai ??= new OpenAI({ apiKey: process.env.TRANSLATION_API_KEY ?? '', baseURL: DIRECT_BASE_URL })

  const completion = await openai.chat.completions.create({
    model: DIRECT_MODEL,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You are a software localisation expert. Reply with JSON only.' },
      {
        role: 'user',
        content: `${translatePrompt(locale, glossary, items, RESEARCH, style)}
Reply with a JSON object of the form {"translations":[{"key":"<the key exactly as given>","text":"<the translation>"}]}, one entry per string above.`
      }
    ]
  })

  stats.requests += 1
  stats.inputTokens += completion.usage?.prompt_tokens ?? 0
  stats.outputTokens += completion.usage?.completion_tokens ?? 0

  const content = completion.choices[0]?.message?.content
  if (!content) throw new Error('endpoint returned an empty reply')
  // A malformed reply must not fall through as "no translations" — that would silently pass validation.
  const parsed = JSON.parse(content) as { translations?: { key: string; text: string }[] }
  return toTranslationMap(parsed.translations)
}

// ------------------------------------------------------------------- pipeline

/**
 * Already-translated strings from the same namespaces as the pending ones. They carry the
 * catalog's register and punctuation conventions — German is 511:3 formal, and a model with no
 * examples writes the informal "gib 0 ein" — for a few hundred tokens and no repository access.
 */
const styleExemplars = (target: Record<string, string>, base: Record<string, string>, pending: PendingKey[]) => {
  const namespaces = new Set(pending.map(({ key }) => key.split('.')[0]))
  const examples: { english: string; translation: string }[] = []

  for (const namespace of namespaces) {
    const candidates = Object.entries(target).filter(
      ([key, value]) =>
        key.startsWith(`${namespace}.`) &&
        !value.startsWith(MARKER) &&
        base[key] !== undefined &&
        base[key].split(/\s+/).length >= 4 &&
        value !== base[key]
    )
    // Longest first: full sentences show the register, one-word labels do not.
    for (const [key, value] of candidates.sort((a, b) => b[1].length - a[1].length).slice(0, 3)) {
      examples.push({ english: base[key], translation: value })
    }
  }

  return examples.slice(0, 12)
}

const collectTargets = (localeFilter?: string): Target[] => {
  const targets: Target[] = []

  for (const { scope, dir } of CATALOGS) {
    const localesDir = path.join(ROOT, dir, 'locales')
    const translateDir = path.join(ROOT, dir, 'translate')
    const basePath = path.join(localesDir, `${BASE_LOCALE}.json`)
    if (!fs.existsSync(basePath)) {
      throw new Error(`${basePath} not found.`)
    }

    const base = flatten(readJson(basePath))
    const zhCnPath = path.join(localesDir, 'zh-cn.json')
    const zhCn = fs.existsSync(zhCnPath) ? flatten(readJson(zhCnPath)) : {}

    const files = [localesDir, translateDir].flatMap((currentDir) =>
      fs
        .readdirSync(currentDir)
        .filter((file) => file.endsWith('.json') && file !== `${BASE_LOCALE}.json`)
        .map((file) => path.join(currentDir, file))
    )

    for (const filePath of files) {
      const locale = path.basename(filePath, '.json')
      if (localeFilter && locale !== localeFilter) continue
      if (!LANGUAGE_NAMES[locale]) {
        console.warn(`⚠️  Unknown locale ${locale}, skipping ${filePath}`)
        continue
      }

      const json = readJson(filePath)
      const pending = Object.entries(flatten(json))
        .filter(([key, value]) => value.startsWith(MARKER) && base[key] !== undefined)
        .map(([key]) => ({
          scope,
          key,
          english: base[key],
          // A zh-cn value still carrying the marker is not a usable reference.
          zhCn: zhCn[key]?.startsWith(MARKER) ? undefined : zhCn[key]
        }))

      if (pending.length > 0) {
        targets.push({ filePath, locale, scope, json, pending, style: styleExemplars(flatten(json), base, pending) })
      }
    }
  }

  return targets
}

const translateTarget = async (target: Target, briefs: Map<string, Brief>, glossary: Glossary) => {
  const accepted: Record<string, string> = {}
  const rejected: { key: string; reason: string }[] = []

  for (let i = 0; i < target.pending.length; i += BATCH_SIZE) {
    const batch = target.pending.slice(i, i + BATCH_SIZE)
    const items = batch.map(({ scope, key, english, zhCn }) => {
      const brief = briefs.get(`${scope}:${key}`)
      return {
        key,
        english,
        ...(zhCn ? { zhCn } : {}),
        ...(brief
          ? { uiRole: brief.uiRole, meaning: brief.meaning, tone: brief.tone, lengthHint: brief.lengthHint }
          : {})
      }
    })

    let translations: Map<string, string>
    try {
      translations = await (TRANSLATOR === 'claude'
        ? translateViaAgent(target.locale, glossary, items, target.style)
        : translateViaEndpoint(target.locale, glossary, items, target.style))
    } catch (error) {
      for (const { key } of batch) {
        rejected.push({ key, reason: `translation request failed: ${(error as Error).message}` })
      }
      continue
    }

    for (const { key, english } of batch) {
      const text = translations.get(key)
      if (text === undefined) {
        rejected.push({ key, reason: 'missing from the model response' })
        continue
      }
      const reason = validate(english, text, glossary.doNotTranslate)
      if (reason) {
        rejected.push({ key, reason })
        continue
      }
      accepted[key] = text.trim()
    }
  }

  return { target, accepted, rejected }
}

const main = async () => {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const localeFilter = args.includes('--locale') ? args[args.indexOf('--locale') + 1] : undefined

  const glossary: Glossary = JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n-glossary.json'), 'utf-8'))
  const targets = collectTargets(localeFilter)

  if (targets.length === 0) {
    console.log('✅ Nothing to translate.')
    return
  }

  const uniqueKeys = new Map<string, PendingKey>()
  for (const target of targets) {
    for (const pendingKey of target.pending) {
      uniqueKeys.set(`${pendingKey.scope}:${pendingKey.key}`, pendingKey)
    }
  }

  const totalPending = targets.reduce((sum, target) => sum + target.pending.length, 0)
  console.log(`📊 ${totalPending} strings pending across ${targets.length} files (${uniqueKeys.size} unique keys)`)

  const startedAt = Date.now()
  let briefs = new Map<string, Brief>()
  if (RESEARCH) {
    console.log(`🔍 Researching UI context with ${RESEARCH_MODEL}...`)
    briefs = await research([...uniqueKeys.values()])
    console.log(`📝 Got ${briefs.size}/${uniqueKeys.size} briefs.`)
  }
  console.log(`📝 Translating with ${TRANSLATOR === 'claude' ? CLAUDE_TRANSLATE_MODEL : DIRECT_MODEL}...`)

  const results = await mapPool(targets, CONCURRENCY, (target) => translateTarget(target, briefs, glossary))

  let rejectedTotal = 0
  for (const { target, accepted, rejected } of results) {
    rejectedTotal += rejected.length
    const label = `${target.scope}/${target.locale}`

    if (dryRun) {
      console.log(`\n📁 ${label}`)
      for (const [key, text] of Object.entries(accepted)) {
        const brief = briefs.get(`${target.scope}:${key}`)
        console.log(`  ✓ ${key} = ${text}`)
        if (brief) console.log(`      ${brief.uiRole} · ${brief.lengthHint} · ${brief.usage}\n      ${brief.meaning}`)
      }
    } else if (Object.keys(accepted).length > 0) {
      for (const [key, text] of Object.entries(accepted)) setAt(target.json, key, text)
      fs.writeFileSync(target.filePath, JSON.stringify(sortedObjectByKeys(target.json), null, 2) + '\n', 'utf-8')
    }

    for (const { key, reason } of rejected) console.error(`  ✗ ${label} ${key}: ${reason}`)
    console.log(
      `${rejected.length === 0 ? '✅' : '⚠️ '} ${label}: ${Object.keys(accepted).length} translated, ${rejected.length} kept as placeholder`
    )
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  const cost = stats.costUsd > 0 ? `, $${stats.costUsd.toFixed(4)}` : ''
  console.log(
    `\n⏱️  research=${RESEARCH} translator=${TRANSLATOR}: ${elapsed}s, ${stats.requests} requests, ${stats.inputTokens} in / ${stats.outputTokens} out tokens${cost}`
  )

  if (rejectedTotal > 0) {
    console.error(`\n❌ ${rejectedTotal} strings failed validation and kept their placeholder. Re-run to retry them.`)
    process.exitCode = 1
    return
  }
  console.log('🎉 All translations completed.')
}

if (require.main === module) {
  void main()
}
