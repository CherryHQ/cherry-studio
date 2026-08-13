/**
 * The validation gate in auto-translate-i18n.ts is the only thing standing between a model
 * response and a shipped locale file. The first suite covers translations that actually reached
 * main and broke the UI; the second covers the opposite failure, which is just as damaging: a
 * rule that rejects a correct translation is deterministic, so that key never leaves its
 * `[to be translated]` placeholder and the UI shows the marker forever.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

import { validate } from '../auto-translate-i18n'

const ROOT = path.resolve(__dirname, '..', '..')
const GLOSSARY = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/i18n-glossary.json'), 'utf-8'))

type I18N = { [key: string]: string | I18N }

const flatten = (obj: I18N, prefix = '', out: Record<string, string> = {}): Record<string, string> => {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    typeof value === 'string' ? (out[fullKey] = value) : flatten(value, fullKey, out)
  }
  return out
}

describe('validate rejects broken translations', () => {
  it('rejects a translation that drops an interpolation variable', () => {
    // de-de library.config.basic.field.max_tool_calls.hint: the {{count}} clause vanished.
    const english = 'Limits tool-call rounds when enabled; otherwise uses the default {{count}}-round limit'
    expect(validate(english, 'Begrenzt Tool-Call-Schleifen, wenn aktiviert')).toMatch(/interpolation/)
  })

  it('rejects a translation that bakes a literal value into an interpolation variable', () => {
    // ja-jp froze {{count}} as "20", so the hint lies as soon as the default changes.
    const english = 'Limits tool-call rounds when enabled; otherwise uses the default {{count}}-round limit'
    const japanese =
      '有効にするとツール呼び出しのラウンド数を制限します。無効の場合は、デフォルトの上限である 20 ラウンドが使用されます'
    expect(validate(english, japanese)).toMatch(/interpolation/)
  })

  it('rejects a translation that renames an interpolation variable', () => {
    // fr-fr models.price.field_for_tier turned {{field}} into {{champ}}, so i18next never substitutes it.
    expect(validate('{{field}}, tier {{index}}', '{{champ}}, niveau {{index}}')).toMatch(/interpolation/)
  })

  it('rejects a translation that echoes the placeholder marker', () => {
    expect(validate('{{count}} channels', '[to be translated]: {{count}} канала')).toMatch(/marker/)
  })

  it('rejects a translation whose marker was itself translated', () => {
    // es-es shipped "[Por traducir]: ..." — once the marker mutates, the retry scan never matches it again.
    const result = validate('This response is still generating.', '[Por traducir]: Esta respuesta se está generando.')
    expect(result).toMatch(/bracketed note/)
  })

  it('rejects an explanation returned in place of a translation', () => {
    // el-gr shipped a paragraph of model reasoning as the UI string.
    const monologue =
      '[Επί προγραμματισμό φράσης: “To be translated:” Θα πρέπει να υπάρξει ένας αριθμός που θα αναφέρεται στον αριθμό των καναλιών. Αυτός ο αριθμός θα πρέπει να αντικατασταθεί στο τέλος της φράσης.] Τελικό κείμενο: “Υπάρχουν {{count}} κανάλια.”'
    expect(validate('{{count}} channels', monologue)).toBeTruthy()
  })

  it('rejects a dropped Trans tag placeholder', () => {
    // The catalog uses named tags, never numeric ones: <provider> becomes a <Link> to the provider
    // settings page (ErrorBlock.tsx), so dropping it renders the provider name as dead plain text.
    const english = 'Please go to the <provider>{{provider}}</provider> to recharge.'
    expect(validate(english, 'Bitte gehen Sie zu {{provider}}, um aufzuladen.')).toMatch(/tag/)
    expect(validate('Read the <0>docs</0> first', 'Lesen Sie zuerst die Dokumentation')).toMatch(/tag/)
  })

  it('rejects a renamed Trans tag placeholder', () => {
    const english = 'Provided by <website>{{provider}}</website>'
    expect(validate(english, 'Fourni par <site>{{provider}}</site>')).toMatch(/tag/)
  })

  it('rejects a translated product name', () => {
    expect(validate('Restart Cherry Studio', 'Перезапустите Вишнёвую Студию', ['Cherry Studio'])).toMatch(
      /Cherry Studio/
    )
  })

  it('rejects an empty translation of a real sentence', () => {
    expect(validate('Delete this topic permanently', '   ')).toMatch(/empty/)
  })
})

describe('validate accepts translations the catalog already relies on', () => {
  it('accepts a faithful translation', () => {
    expect(validate('{{count}} channels', '{{count}} 個のチャンネル')).toBeNull()
    expect(validate('Add Provider', 'Anbieter hinzufügen', ['Cherry Studio'])).toBeNull()
    expect(validate('Read the <0>docs</0> first', 'Lisez d’abord la <0>documentation</0>')).toBeNull()
    const english = 'Please go to the <provider>{{provider}}</provider> to recharge.'
    expect(validate(english, 'Rufen Sie <provider>{{provider}}</provider> auf, um aufzuladen.')).toBeNull()
  })

  it('accepts a technical string left in English', () => {
    // "Access Key ID", "macOS / Linux" and CLI snippets are correct untranslated; rejecting them
    // would strand the key on its placeholder every run.
    expect(validate('Access Key ID', 'Access Key ID')).toBeNull()
    expect(validate('nvm: nvm install 22 && nvm use 22', 'nvm: nvm install 22 && nvm use 22')).toBeNull()
  })

  it('accepts a protected term whose case or hyphenation shifted', () => {
    expect(validate('Exit GitHub', '退出 Github', ['GitHub'])).toBeNull()
    expect(validate('Cherry Studio diagnostics', 'Cherry-Studio-Diagnose', ['Cherry Studio'])).toBeNull()
  })

  it('accepts an empty translation of a punctuation-only source', () => {
    // onboarding.privacy.period is a bare "." that most languages drop.
    expect(validate('.', '')).toBeNull()
  })

  /**
   * The real guard: run the gate over every string already in the repo. These translations are
   * live, so a flag here is either a defect to fix or a rule that is too strict — both are worth
   * failing on. Adding a tolerance instead of fixing the cause defeats the point of the check.
   */
  it('flags nothing in the shipped catalog', () => {
    const flagged: string[] = []
    let checked = 0

    for (const dir of ['src/renderer/i18n', 'src/main/i18n']) {
      const base = flatten(JSON.parse(fs.readFileSync(path.join(ROOT, dir, 'locales/en-us.json'), 'utf-8')))
      for (const sub of ['locales', 'translate']) {
        const subDir = path.join(ROOT, dir, sub)
        for (const file of fs.readdirSync(subDir).filter((f) => f.endsWith('.json') && f !== 'en-us.json')) {
          const target = flatten(JSON.parse(fs.readFileSync(path.join(subDir, file), 'utf-8')))
          for (const [key, value] of Object.entries(target)) {
            if (base[key] === undefined || value.startsWith('[to be translated]')) continue
            checked++
            const reason = validate(base[key], value, GLOSSARY.doNotTranslate)
            if (reason) flagged.push(`${file} ${key}: ${reason}`)
          }
        }
      }
    }

    expect(checked).toBeGreaterThan(10_000)
    expect(flagged, `validation would strand these on their placeholder:\n${flagged.join('\n')}`).toEqual([])
  })
})
