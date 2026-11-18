import * as z from 'zod'

/** Validate a display candidate without rewriting the text the runtime supplied. */
export const promptSuggestionForDisplay = z
  .string()
  .max(262_144, { abort: true })
  .refine((value) => {
    const checked = value.normalize('NFC').trim()
    return (
      checked.length > 0 &&
      !/^[/@!#]/.test(checked) &&
      !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u.test(checked) &&
      !/-----BEGIN [A-Z ]*PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(checked)
    )
  })
  .catch('').parse
