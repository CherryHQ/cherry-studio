/**
 * Generate the "Multilingual" markdown fragment from the locale .json files
 * actually shipped under src/renderer/src/i18n/, joined with a maintained
 * locale-code → display-name map.
 *
 * Locales discovered on disk but missing from the map fall through with the
 * raw locale code (loud rather than silent), so adding a new locale on disk
 * surfaces immediately as e.g. "vi-vn" until someone fills in the friendly
 * display name.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import type { Language } from '../templating'

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..')
const BASE_LOCALES_DIR = path.join(ROOT_DIR, 'src/renderer/src/i18n/locales')
const TRANSLATED_LOCALES_DIR = path.join(ROOT_DIR, 'src/renderer/src/i18n/translate')
const DISPLAY_NAMES_JSON = path.join(__dirname, '..', 'language-display-names.json')

interface DisplayNameFile {
  displayNames: Record<string, Record<Language, string>>
  order: string[]
}

function discoverLocales(): Set<string> {
  const codes = new Set<string>()
  for (const dir of [BASE_LOCALES_DIR, TRANSLATED_LOCALES_DIR]) {
    if (!fs.existsSync(dir)) continue
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.json')) codes.add(f.replace(/\.json$/, ''))
    }
  }
  return codes
}

function loadDisplayNames(): DisplayNameFile {
  const raw = JSON.parse(fs.readFileSync(DISPLAY_NAMES_JSON, 'utf-8'))
  return { displayNames: raw.displayNames, order: raw.order }
}

function orderedLocales(discovered: Set<string>, order: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const code of order) {
    if (discovered.has(code) && !seen.has(code)) {
      seen.add(code)
      result.push(code)
    }
  }
  for (const code of [...discovered].sort()) {
    if (!seen.has(code)) {
      seen.add(code)
      result.push(code)
    }
  }
  return result
}

export interface LanguagesFragment {
  count: number
  summary: string
}

export function generateLanguagesFragment(lang: Language): LanguagesFragment {
  const discovered = discoverLocales()
  const { displayNames, order } = loadDisplayNames()
  const ordered = orderedLocales(discovered, order)
  const summary = ordered.map((code) => displayNames[code]?.[lang] ?? code).join('/')
  return { count: ordered.length, summary }
}
