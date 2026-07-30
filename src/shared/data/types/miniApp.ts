/**
 * MiniApp entity types
 *
 * System default apps are runtime-defined; the DB stores only user preferences
 * (status, orderKey) for them. Custom apps store full data + preferences.
 *
 * Ordering: visible rows (`enabled` + `pinned`) share one fractional-indexing
 * `orderKey` space; `disabled` rows use a separate key space.
 */

import * as z from 'zod'

export type MiniAppId = string & { readonly __brand: unique symbol }

// Region types
export type MiniAppRegion = 'CN' | 'Global'
export type MiniAppRegionFilter = 'auto' | MiniAppRegion

// Status enum
export const MiniAppStatusSchema = z.enum(['enabled', 'disabled', 'pinned'])
export type MiniAppStatus = z.infer<typeof MiniAppStatusSchema>

export const MiniAppRegionSchema = z.enum(['CN', 'Global'])

/**
 * MiniApp entity schema.
 *
 * `presetMiniAppId` mirrors `userProvider.presetProviderId`:
 *   - non-null  → row inherits from a PRESETS_MINI_APPS entry (preset-derived)
 *   - null      → pure custom app
 */
export const MiniAppSchema = z.object({
  appId: z.string(),
  presetMiniAppId: z.string().nullable(),
  status: MiniAppStatusSchema,
  orderKey: z.string(),
  name: z.string(),
  url: z.string(),
  /**
   * Preset logo key (a `getMiniAppsLogo`-resolvable id). Absent for custom apps
   * with an uploaded logo, which carry {@link logoSrc} instead.
   */
  logo: z.string().optional(),
  /**
   * Ready-to-render URL for an uploaded logo, resolved main-side from the
   * `file_entry` (`file://…`). Mutually exclusive with {@link logo}; the
   * renderer renders it directly and never reconstructs a disk path.
   */
  logoSrc: z.string().optional(),
  bordered: z.boolean().optional(),
  background: z.string().optional(),
  supportedRegions: z.array(MiniAppRegionSchema).optional(),
  configuration: z.unknown().optional(),
  nameKey: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
})

export type MiniApp = z.infer<typeof MiniAppSchema>

/**
 * The subset needed to rebuild a *transient* mini app — one opened via
 * `openSmartMiniApp` (OpenClaw's dashboard, the S3 help page, the release notes).
 * Those rows never reach the database and live only in the opening window's
 * keep-alive cache, which is Memory-tier and therefore per-window. Detaching such
 * a tab must carry this descriptor to the new window, which would otherwise have
 * nothing to resolve `/app/mini-app/<id>` against.
 *
 * Deliberately not `MiniApp`: `status` / `orderKey` / `presetMiniAppId` are
 * ownership facts of the receiving window's cache, reconstructed there.
 */
export const TransientMiniAppSchema = MiniAppSchema.pick({
  appId: true,
  name: true,
  url: true,
  logo: true,
  logoSrc: true
})

export type TransientMiniApp = z.infer<typeof TransientMiniAppSchema>
