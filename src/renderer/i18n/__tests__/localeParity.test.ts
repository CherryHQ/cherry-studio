import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Locale synchronization contract.
 *
 * `pnpm i18n:sync` can backfill a missing key with a `[to be translated]:` placeholder, but
 * `scripts/i18n-check.ts` REJECTS that marker (i18n-check-values.ts, `validate`) — the
 * frozen-head `basic-checks` job fails either way. The only way to add a key to a
 * translated catalog is to write the real translation alongside the source string.
 *
 * This guard pins that contract at the catalog level: every catalog that ships in the
 * renderer must carry exactly the same key set as the base locale, and every translated
 * value must be a real string (no placeholder, no untranslated English echo for a
 * sentence-level string). See inv_d062f6370005aaeb#f1 — five keys added to en-us.json
 * were absent from the Thai catalog, so Thai users got English fallback and the
 * locale-synchronization gate failed.
 */

const LOCALES_DIR = join(__dirname, '..', 'locales')
const BASE_LOCALE = 'en-us'

const readCatalog = (file: string): Record<string, string> =>
  JSON.parse(readFileSync(join(LOCALES_DIR, file), 'utf-8')) as Record<string, string>

const base = readCatalog(`${BASE_LOCALE}.json`)
const translatedFiles = readdirSync(LOCALES_DIR).filter(
  (file) => file.endsWith('.json') && file !== `${BASE_LOCALE}.json`
)

describe('renderer locale catalogs', () => {
  it('ships every base-locale key in every translated catalog', () => {
    const missing: string[] = []
    for (const file of translatedFiles) {
      const catalog = readCatalog(file)
      for (const key of Object.keys(base)) {
        if (!(key in catalog)) missing.push(`${file}: ${key}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('ships no key in a translated catalog that the base locale lacks', () => {
    const extra: string[] = []
    for (const file of translatedFiles) {
      const catalog = readCatalog(file)
      for (const key of Object.keys(catalog)) {
        if (!(key in base)) extra.push(`${file}: ${key}`)
      }
    }
    expect(extra).toEqual([])
  })

  // The keys added for the steer-time API retry record and the empty-paused turn are the
  // ones that drifted, so pin their Thai rendering explicitly: a placeholder marker, an
  // empty value, or a copy of the English string would all pass a bare key-presence check.
  it('carries real Thai translations for the agent retry and paused-turn strings', () => {
    const thai = readCatalog('th-th.json')

    const required = [
      'agent.session.api_retry.history',
      'agent.session.api_retry.history_detail',
      'agent.session.paused_empty',
      'error.agent_turn_failed_no_detail',
      'error.agent_turn_no_output'
    ]

    for (const key of required) {
      const value = thai[key]?.trim() ?? ''
      expect(value, `${key} must be present in th-th.json`).not.toBe('')
      expect(value, `${key} must not be a sync placeholder`).not.toMatch(/to be translated/i)
      expect(value, `${key} must not be an untranslated English echo`).not.toBe(base[key].trim())
    }

    // Interpolations must survive translation verbatim or i18next renders the raw variable.
    for (const key of required) {
      const placeholders = (text: string) => (text.match(/{{[^}]*}}/g) ?? []).sort()
      expect(placeholders(thai[key]), `${key} must keep its interpolation variables`).toEqual(placeholders(base[key]))
    }
  })
})
