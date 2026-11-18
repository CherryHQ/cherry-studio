/** Validate a display candidate without rewriting the text the runtime supplied. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Runtime suggestion candidates are untrusted; this boundary rejects unsafe text without rewriting valid input.
export function promptSuggestionForDisplay(value: unknown): string {
  if (typeof value !== 'string' || value.length > 262_144) return ''
  const checked = value.normalize('NFC').trim()
  if (!checked || /^[/@!#]/.test(checked)) return ''
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u.test(checked)) return ''
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(checked)) return ''
  return value
}
