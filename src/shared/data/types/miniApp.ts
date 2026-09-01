/**
 * MiniApp entity types
 *
 * System default apps are runtime-defined; the DB stores only user preferences
 * (status, orderKey) for them. Custom apps store full data + preferences.
 *
 * Ordering: visible rows (`enabled` + `pinned`) share one fractional-indexing
 * `orderKey` space; `disabled` rows use a separate key space.
 */

import { LocalizedNameSchema } from '@shared/types/miniAppManifest'
import * as z from 'zod'

export type MiniAppId = string & { readonly __brand: unique symbol }

// Region types
export type MiniAppRegion = 'CN' | 'Global'
export type MiniAppRegionFilter = 'auto' | MiniAppRegion

// Status enum
export const MiniAppStatusSchema = z.enum(['enabled', 'disabled', 'pinned'])
export type MiniAppStatus = z.infer<typeof MiniAppStatusSchema>

export const MiniAppRegionSchema = z.enum(['CN', 'Global'])

export const MiniAppKindSchema = z.enum(['site', 'app'])
export type MiniAppKind = z.infer<typeof MiniAppKindSchema>

const MiniAppBaseSchema = z.object({
  appId: z.string(),
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
  nameKey: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
})

/**
 * Site mini app: a remote URL in a shared partition.
 *
 * `presetMiniAppId` mirrors `userProvider.presetProviderId`:
 *   - non-null  → row inherits from a PRESETS_MINI_APPS entry (preset-derived)
 *   - null      → pure custom app
 */
export const SiteMiniAppSchema = MiniAppBaseSchema.extend({
  kind: z.literal('site'),
  presetMiniAppId: z.string().nullable(),
  supportedRegions: z.array(MiniAppRegionSchema).optional(),
  configuration: z.unknown().optional()
})

/** Local mini app: an installed package with its own partition, origin and grants. */
export const LocalMiniAppSchema = MiniAppBaseSchema.extend({
  kind: z.literal('app'),
  /** `= appId` for a builtin app, `null` for a user-installed one — the official badge's only test (design §3.1). */
  presetMiniAppId: z.string().nullable(),
  version: z.string(),
  /**
   * The raw per-locale table. `name` above is already resolved for the current UI
   * language; this is kept alongside it so the detail panel can show what the
   * author actually shipped, and so an update diff can compare tables rather than
   * two strings that happen to have been resolved under different locales.
   */
  nameI18n: LocalizedNameSchema,
  /** The model `ai.chat` uses by default; `null` = the global default model. Written via `PATCH /mini-apps/:appId`. */
  aiModelId: z.string().nullable(),
  /** The model `ai.chat({ model: 'quick' })` uses; `null` = the global quick model. */
  aiQuickModelId: z.string().nullable()
})

export const MiniAppSchema = z.discriminatedUnion('kind', [SiteMiniAppSchema, LocalMiniAppSchema])

export type SiteMiniApp = z.infer<typeof SiteMiniAppSchema>
export type LocalMiniApp = z.infer<typeof LocalMiniAppSchema>
export type MiniApp = z.infer<typeof MiniAppSchema>

/**
 * The subset needed to rebuild a *transient* mini app — one opened via
 * `openSmartMiniApp` (OpenClaw's dashboard, the S3 help page, the release notes).
 * Those rows never reach the database, so no window can resolve
 * `/app/mini-app/<id>` for them through DataApi; they are published instead to the
 * shared cache under `mini_app.transient_descriptor.<appId>`, which every window
 * reads (see `MiniAppPage`).
 *
 * Deliberately not `MiniApp`: `status` / `orderKey` / `presetMiniAppId` are
 * ownership facts of each window's own keep-alive cache, reconstructed there by
 * `toTransientMiniApp`.
 */
export type TransientMiniApp = Pick<MiniApp, 'appId' | 'name' | 'url' | 'logo' | 'logoSrc'>
