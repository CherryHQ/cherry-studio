/**
 * The validation gate in auto-translate-i18n.ts is the only thing standing between a model
 * response and a shipped locale file. Every case below is a translation that actually reached
 * main and broke the UI, so a regression here means the same class of damage ships again.
 */
import { describe, expect, it } from 'vitest'

import { validate } from '../auto-translate-i18n'

describe('validate', () => {
  it('rejects a translation that drops an interpolation variable', () => {
    // de-de library.config.basic.field.max_tool_calls.hint: the {{count}} clause vanished.
    const english = 'Limits tool-call rounds when enabled; otherwise uses the default {{count}}-round limit'
    expect(validate(english, 'Begrenzt Tool-Call-Schleifen, wenn aktiviert', 'de-de')).toMatch(/interpolation/)
  })

  it('rejects a translation that bakes a literal value into an interpolation variable', () => {
    // ja-jp froze {{count}} as "20", so the hint lies as soon as the default changes.
    const english = 'Limits tool-call rounds when enabled; otherwise uses the default {{count}}-round limit'
    const japanese =
      '有効にするとツール呼び出しのラウンド数を制限します。無効の場合は、デフォルトの上限である 20 ラウンドが使用されます'
    expect(validate(english, japanese, 'ja-jp')).toMatch(/interpolation/)
  })

  it('rejects a translation that renames an interpolation variable', () => {
    // fr-fr models.price.field_for_tier turned {{field}} into {{champ}}, so i18next never substitutes it.
    expect(validate('{{field}}, tier {{index}}', '{{champ}}, niveau {{index}}', 'fr-fr')).toMatch(/interpolation/)
  })

  it('rejects a translation that echoes the placeholder marker', () => {
    expect(validate('{{count}} channels', '[to be translated]: {{count}} канала', 'ru-ru')).toMatch(/marker/)
  })

  it('rejects a translation whose marker was itself translated', () => {
    // es-es shipped "[Por traducir]: ..." — once the marker mutates, the retry scan never matches it again.
    const result = validate(
      'This response is still generating.',
      '[Por traducir]: Esta respuesta se está generando.',
      'es-es'
    )
    expect(result).toMatch(/bracketed note/)
  })

  it('rejects an explanation returned in place of a translation', () => {
    // el-gr shipped a paragraph of model reasoning as the UI string.
    const monologue =
      '[Επί προγραμματισμό φράσης: “To be translated:” Θα πρέπει να υπάρξει ένας αριθμός που θα αναφέρεται στον αριθμό των καναλιών. Αυτός ο αριθμός θα πρέπει να αντικατασταθεί στο τέλος της φράσης.] Τελικό κείμενο: “Υπάρχουν {{count}} κανάλια.”'
    expect(validate('{{count}} channels', monologue, 'el-gr')).toBeTruthy()
  })

  it('rejects a dropped Trans tag placeholder', () => {
    expect(validate('Read the <0>docs</0> first', 'Lesen Sie zuerst die Dokumentation', 'de-de')).toMatch(/tag/)
  })

  it('rejects a translated product name', () => {
    expect(validate('Restart Cherry Studio', 'Перезапустите Вишнёвую Студию', 'ru-ru', ['Cherry Studio'])).toMatch(
      /Cherry Studio/
    )
  })

  it('rejects an untouched English sentence in a non-Latin locale', () => {
    expect(validate('Delete this topic permanently', 'Delete this topic permanently', 'ja-jp')).toMatch(/identical/)
  })

  it('accepts a faithful translation', () => {
    expect(validate('{{count}} channels', '{{count}} 個のチャンネル', 'ja-jp')).toBeNull()
    expect(validate('Add Provider', 'Anbieter hinzufügen', 'de-de', ['Cherry Studio'])).toBeNull()
    expect(validate('Read the <0>docs</0> first', 'Lisez d’abord la <0>documentation</0>', 'fr-fr')).toBeNull()
  })

  it('accepts a short shared token that is identical across languages', () => {
    // "OK" / "API" style strings are legitimately unchanged; only multi-word copies are suspect.
    expect(validate('API Key', 'API Key', 'ja-jp')).toBeNull()
  })
})
