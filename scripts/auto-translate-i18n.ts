/**
 * Translation of every locale except the base one.
 *
 * Source text always comes from the base locale by full key path and the `[to be translated]`
 * marker never enters model input, so nothing can echo or retranslate it. Every reply is
 * validated deterministically before it is written: a translation that loses an interpolation
 * variable, a component tag or a `$t()` reference is dropped and its placeholder kept, and the
 * run exits non-zero.
 *
 * Translation itself is one batched request per locale to an OpenAI-compatible endpoint, carrying
 * the full key path, the zh-cn reference, the glossary and style examples from the same namespaces.
 *
 * Usage: pnpm i18n:translate [--locale <code>] [--dry-run]
 */
import { OpenAI } from '@cherrystudio/openai'
import * as fs from 'fs'
import * as path from 'path'

import { sortedObjectByKeys } from './sort'

type I18NValue = string | { [key: string]: I18NValue }
type I18N = { [key: string]: I18NValue }

type PendingKey = { scope: string; key: string; english: string; zhCn?: string }
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
const MODEL = process.env.TRANSLATION_MODEL ?? 'deepseek/deepseek-v4-flash'
const BASE_URL = process.env.TRANSLATION_BASE_URL ?? 'https://api.ppinfra.com/openai/v1'
// 400 strings took 289s in batches of 50 and 118s in one batch of 200, with the same completeness.
const BATCH_SIZE = Number(process.env.I18N_BATCH_SIZE ?? 200)
const CONCURRENCY = 3

const stats = { inputTokens: 0, outputTokens: 0, requests: 0 }

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

// ---------------------------------------------------------------- translation

const translatePrompt = (locale: string, glossary: Glossary, items: unknown[], style: StyleExample[]): string => {
  const pins = Object.entries(glossary.terms)
    .map(([term, entry]) => {
      const pinned = entry[locale]
      const note = entry.note ? ` (${entry.note})` : ''
      return pinned ? `- "${term}" → "${pinned}"${note}` : `- "${term}"${note}`
    })
    .join('\n')

  return `Translate Cherry Studio UI strings from English into ${LANGUAGE_NAMES[locale]}.

Cherry Studio is a desktop AI chat client. Each string below comes with its full i18n key path, which tells you which screen and which kind of control it belongs to — translate for that situation, not for the sentence in isolation.

Rules:
- Return only the translated string. No explanations, no bracketed notes, no quotes around the result.
- Copy every {{variable}} through unchanged. Never translate or rename the text inside {{ }}, never drop one, and never substitute the value it stands for.
- Copy every tag placeholder and $t(...) reference through unchanged, including named ones such as <provider>...</provider>, <link>...</link>, <strong>...</strong> and <INPUT>...</INPUT>. They wrap the text in a link or other component at runtime, so translate what is between the tags and never rename, reorder away or drop the tags themselves.
- Keep these verbatim in Latin script: ${glossary.doNotTranslate.join(', ')}.
- Keep button, menu and label strings roughly as short as the English, because they sit in fixed-width controls.
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

let openai: OpenAI | undefined
const translateBatch = async (locale: string, glossary: Glossary, items: unknown[], style: StyleExample[]) => {
  openai ??= new OpenAI({ apiKey: process.env.TRANSLATION_API_KEY ?? '', baseURL: BASE_URL })

  const completion = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You are a software localisation expert. Reply with JSON only.' },
      {
        role: 'user',
        content: `${translatePrompt(locale, glossary, items, style)}
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
  return new Map((parsed.translations ?? []).map(({ key, text }) => [key, text]))
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

const translateTarget = async (target: Target, glossary: Glossary) => {
  const accepted: Record<string, string> = {}
  const rejected: { key: string; reason: string }[] = []

  for (let i = 0; i < target.pending.length; i += BATCH_SIZE) {
    const batch = target.pending.slice(i, i + BATCH_SIZE)
    const items = batch.map(({ key, english, zhCn }) => ({ key, english, ...(zhCn ? { zhCn } : {}) }))

    let translations: Map<string, string>
    try {
      translations = await translateBatch(target.locale, glossary, items, target.style)
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
  console.log(`📝 Translating with ${MODEL}...`)

  const results = await mapPool(targets, CONCURRENCY, (target) => translateTarget(target, glossary))

  let rejectedTotal = 0
  for (const { target, accepted, rejected } of results) {
    rejectedTotal += rejected.length
    const label = `${target.scope}/${target.locale}`

    if (dryRun) {
      console.log(`\n📁 ${label}`)
      for (const [key, text] of Object.entries(accepted)) console.log(`  ✓ ${key} = ${text}`)
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
  console.log(
    `\n⏱️  ${elapsed}s, ${stats.requests} requests of up to ${BATCH_SIZE} strings, ${stats.inputTokens} in / ${stats.outputTokens} out tokens`
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
