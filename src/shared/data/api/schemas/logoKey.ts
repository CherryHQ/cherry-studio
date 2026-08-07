import * as z from 'zod'

/**
 * Preset icon id / `icon:<id>` ref. Short — uploads go through the set-logo
 * command. Inline bytes (`data:`), stored-file refs (`file:` / `file://`), and
 * remote URLs (`http:` / `https:`) are rejected: a key must never carry image
 * bytes, mint a stored-image `file_ref`, or (re)open a remote-image write
 * surface. Legacy URL/data values stay isolated to the migration/compat
 * boundary, not this write contract.
 *
 * A no-dependency leaf (zod only) so the DataApi (`logo.ts`) and IPC
 * (`entityImage.ts`) schema graphs share one definition without either
 * depending on the other's module.
 */
export const LogoKeySchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((v) => !/^(data:|file:|https?:)/i.test(v), 'logo key must not be a data:, file:, or http(s): ref')
