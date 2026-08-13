/**
 * Context-aware translation of every locale except the base one.
 *
 * Phase A researches each pending key once — where it is used, what UI element renders it —
 * and shares that brief across all locales. Phase B translates from the brief without tools.
 * Phase C validates deterministically: a translation that loses an interpolation variable or
 * carries a meta note is dropped and its placeholder kept, so a bad model response can never
 * reach a locale file.
 *
 * Usage: pnpm i18n:translate [--locale <code>] [--dry-run]
 */
import { type Options, query } from '@anthropic-ai/claude-agent-sdk'
import * as fs from 'fs'
import * as path from 'path'

import { sortedObjectByKeys } from './sort'

type I18NValue = string | { [key: string]: I18NValue }
type I18N = { [key: string]: I18NValue }

type PendingKey = { scope: string; key: string; english: string; zhCn?: string }
type Brief = { key: string; uiRole: string; meaning: string; tone: string; lengthHint: string; usage: string }
type Target = { filePath: string; locale: string; scope: string; json: I18N; pending: PendingKey[] }
type Glossary = { doNotTranslate: string[]; terms: Record<string, Record<string, string>> }

const MARKER = '[to be translated]'
const ROOT = path.resolve(__dirname, '..')
const BASE_LOCALE = process.env.TRANSLATION_BASE_LOCALE ?? 'en-us'
const RESEARCH_MODEL = process.env.I18N_RESEARCH_MODEL ?? 'claude-sonnet-5'
const TRANSLATE_MODEL = process.env.I18N_TRANSLATE_MODEL ?? 'claude-sonnet-5'
const BATCH_SIZE = 50
const CONCURRENCY = 3

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

const NON_LATIN_LOCALES = new Set(['zh-cn', 'zh-tw', 'ja-jp', 'ru-ru', 'el-gr'])

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
const tagPlaceholders = (text: string) => (text.match(/<\/?\d+\s*\/?>/g) ?? []).sort()
const nestedKeys = (text: string) => (text.match(/\$t\([^)]*\)/g) ?? []).sort()

/**
 * Returns a rejection reason, or null when the translation is safe to write.
 * Every rule here corresponds to a failure this pipeline has actually shipped.
 */
export const validate = (
  english: string,
  translation: string,
  locale: string,
  doNotTranslate: string[] = []
): string | null => {
  const text = translation.trim()

  if (!text) return 'empty'
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

  for (const term of doNotTranslate) {
    if (english.includes(term) && !text.includes(term)) return `dropped untranslatable term "${term}"`
  }

  if (NON_LATIN_LOCALES.has(locale) && english.trim().split(/\s+/).length >= 3 && text === english.trim()) {
    return 'identical to the English source'
  }

  return null
}

// ----------------------------------------------------------------- agent calls

const runQuery = async <T>(prompt: string, options: Options): Promise<T> => {
  for await (const message of query({ prompt, options })) {
    if (message.type !== 'result') continue
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

const translatePrompt = (locale: string, glossary: Glossary, items: unknown[]): string => {
  const pins = Object.entries(glossary.terms)
    .map(([term, entry]) => {
      const pinned = entry[locale]
      const note = entry.note ? ` (${entry.note})` : ''
      return pinned ? `- "${term}" → "${pinned}"${note}` : `- "${term}"${note}`
    })
    .join('\n')

  return `Translate Cherry Studio UI strings from English into ${LANGUAGE_NAMES[locale]}.

Cherry Studio is a desktop AI chat client. Each string below comes with a brief describing where it appears in the UI — translate for that situation, not for the sentence in isolation.

Rules:
- Return only the translated string. No explanations, no bracketed notes, no quotes around the result.
- Copy every {{variable}} through unchanged. Never translate or rename the text inside {{ }}, never drop one, and never substitute the value it stands for.
- Copy <0>...</0> style tag placeholders and $t(...) references through unchanged.
- Keep these verbatim in Latin script: ${glossary.doNotTranslate.join(', ')}.
- Follow lengthHint: a "tight" string must stay roughly as short as the English, because it sits in a fixed-width control.
- Use the established terminology below. Inflect it as the target language requires, but do not switch to a synonym.
- zhCn is a human-reviewed translation of the same string. Use it to resolve ambiguity in the English; do not translate from it.
- Match the register that desktop software uses in the target language.

Terminology:
${pins}

Strings:
${JSON.stringify(items, null, 2)}
`
}

const translateBatch = async (locale: string, glossary: Glossary, items: unknown[]) => {
  const result = await runQuery<{ translations: { key: string; text: string }[] }>(
    translatePrompt(locale, glossary, items),
    {
      model: TRANSLATE_MODEL,
      cwd: ROOT,
      settingSources: [],
      allowedTools: [],
      permissionMode: 'dontAsk',
      maxTurns: 2,
      outputFormat: { type: 'json_schema', schema: TRANSLATION_SCHEMA }
    }
  )
  return new Map((result.translations ?? []).map(({ key, text }) => [key, text]))
}

// ------------------------------------------------------------------- pipeline

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
        targets.push({ filePath, locale, scope, json, pending })
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
      translations = await translateBatch(target.locale, glossary, items)
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
      const reason = validate(english, text, target.locale, glossary.doNotTranslate)
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
  console.log(`🔍 Researching UI context with ${RESEARCH_MODEL}...`)

  const briefs = await research([...uniqueKeys.values()])
  console.log(`📝 Got ${briefs.size}/${uniqueKeys.size} briefs. Translating with ${TRANSLATE_MODEL}...`)

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

  if (rejectedTotal > 0) {
    console.error(`\n❌ ${rejectedTotal} strings failed validation and kept their placeholder. Re-run to retry them.`)
    process.exitCode = 1
    return
  }
  console.log('\n🎉 All translations completed.')
}

if (require.main === module) {
  void main()
}
