import type { CacheMiniAppAttention } from '@shared/data/cache/cacheValueTypes'
import { LocalMiniAppSchema } from '@shared/data/types/miniApp'
import { MiniAppActivityListingSchema } from '@shared/types/miniAppActivity'
import { LocalizedNameSchema, MiniAppIdSchema, MiniAppManifestSchema } from '@shared/types/miniAppManifest'
import type { QuotaUsageWithLimits } from '@shared/types/miniAppQuota'
import * as z from 'zod'

import { defineRoute } from '../define'
import { LogoImageIntentSchema } from './entityImage'

/** Whole locale tables, as `MiniAppIdentityChange` pins them at check time. */
const IdentityChangeSchema = z.object({
  name: z.object({ from: LocalizedNameSchema, to: LocalizedNameSchema }).optional(),
  icon: z.object({ from: z.string().nullable(), to: z.string().nullable() }).optional()
})

/** The two shapes that carry an update token — what the review card renders. */
const UpdateOfferSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ready'),
    version: z.string(),
    addedOptional: z.array(z.string()),
    removed: z.array(z.string()),
    updateToken: z.string(),
    identityChange: IdentityChangeSchema.optional(),
    releaseNotes: z.string().optional()
  }),
  z.object({
    status: z.literal('needs-consent'),
    version: z.string(),
    added: z.array(z.string()),
    addedOptional: z.array(z.string()),
    removed: z.array(z.string()),
    addedHosts: z.array(z.string()),
    updateToken: z.string(),
    identityChange: IdentityChangeSchema.optional(),
    releaseNotes: z.string().optional()
  })
])

/** Mirrors `UpdateStatus` (main `webInstaller.ts`); the token is the only thing that crosses back. */
const UpdateStatusSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('current'),
    updateToken: z.undefined().optional(),
    identityChange: z.undefined().optional()
  }),
  ...UpdateOfferSchema.options
])

const MiniAppSourceSchema = z.enum(['file', 'url', 'builtin'])
const InstalledAppSummarySchema = z.object({ version: z.string(), source: MiniAppSourceSchema })

/**
 * What the consent card shows. Decided by VERSION against an installed app: higher is
 * an `upgrade` (the update flow's token), the same or lower is an `install` carrying the
 * "already installed" facts for a reinstall. Only the tokens cross back.
 */
const InstallPreviewSummarySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('install'),
    installToken: z.string().min(1),
    manifest: MiniAppManifestSchema,
    iconDataUrl: z.string().nullable(),
    required: z.array(z.string()),
    optional: z.array(z.string()),
    source: MiniAppSourceSchema,
    installed: InstalledAppSummarySchema.extend({ relation: z.enum(['same', 'downgrade']) }).optional()
  }),
  z.object({
    kind: z.literal('upgrade'),
    appId: MiniAppIdSchema,
    manifest: MiniAppManifestSchema,
    iconDataUrl: z.string().nullable(),
    source: MiniAppSourceSchema,
    installed: InstalledAppSummarySchema,
    update: UpdateOfferSchema
  })
])

/** Mirrors `CacheMiniAppAttention` — the dot's reasons, as main derives them. */
const MiniAppAttentionSchema = z.object({
  appId: MiniAppIdSchema,
  updateVersion: z.string().nullable(),
  pendingPermissions: z.array(z.string()),
  updating: z.object({ version: z.string(), fraction: z.number().nullable() }).nullable()
})

const AppIdInputSchema = z.object({ appId: MiniAppIdSchema })
const PermissionInputSchema = z.strictObject({ appId: MiniAppIdSchema, permission: z.string().min(1) })

/**
 * The `mini_app.detail` response, next to the route that returns it: main builds it,
 * the IPC layer carries it, the renderer renders it — one cross-process contract.
 */
export interface MiniAppDetail {
  appId: string
  name: string
  description: string
  version: string
  /** The launcher tile's logo, as the `MiniApp` DTO carries it: a preset key on `logo`, an uploaded image on `logoSrc`. */
  logo?: string
  logoSrc?: string
  /** Where it came from — the panel shows "installed from example.com" for web sources. */
  source: 'file' | 'url' | 'builtin'
  sourceUrl: string | null
  /**
   * Whether a rollback snapshot is retained. Derived in the owner from
   * `previousContentHash`: the panel decides whether to show the button, and that
   * column means nothing to the renderer.
   */
  canRollback: boolean
  /**
   * Every leaf the current manifest declares. `optional` is what the panel renders off:
   * a REQUIRED leaf gets no toggle at all, because the service refuses to revoke one
   * — a button that always fails is worse than no button.
   */
  declared: Array<{ key: string; optional: boolean; granted: boolean }>
  grants: string[]
  /** The declared host allowlist, read-only in the panel. Not grants — see `declared`. */
  network: string[]
  /** Leaves a Cherry update added under a namespace this app already declared (decision A). */
  pendingAdditions: string[]
  /** The version the last update check found for THIS app, or null — the panel's "new version" chip. */
  updateVersion: string | null
  /** Read here with the rest of the panel's state; written via `PATCH /mini-apps/:appId`. */
  aiModelId: string | null
  aiQuickModelId: string | null
  /** Usage AND the ceiling it is measured against — the panel draws a bar, not a number. */
  storage: QuotaUsageWithLimits
  file: QuotaUsageWithLimits
  /** What the installed package itself takes on disk. */
  packageBytes: number
  /** The previous version kept for rollback, or 0 when none is retained. */
  snapshotBytes: number
}

/**
 * Mini-app imperative IPC commands. `mini_app.settings.set_logo` mirrors
 * `provider.set_logo`: raw bytes + intent in, the main handler delegates to
 * `setMiniAppLogo` (create `file_entry` → bind the slot → compensate).
 */
export const miniAppRequestSchemas = {
  // Verbs on the app itself.
  /** The detail panel's one read; the shape is `MiniAppDetail` below. */
  'mini_app.detail': defineRoute({ input: AppIdInputSchema, output: z.custom<MiniAppDetail>() }),
  'mini_app.uninstall': defineRoute({
    input: z.object({ appId: MiniAppIdSchema }),
    output: z.void()
  }),
  'mini_app.clear_data': defineRoute({ input: AppIdInputSchema, output: z.void() }),

  // Install flow: preview (file / url / builtin) → confirm or cancel by token.
  /** Native file dialog + zero-extraction preview. `null` = the user dismissed the dialog. */
  'mini_app.install.pick_and_preview': defineRoute({
    input: z.void(),
    output: InstallPreviewSummarySchema.nullable()
  }),
  /** Fetch-and-validate by manifest address; the card is the file source's, the confirm route too. */
  'mini_app.install.preview_url': defineRoute({
    input: z.strictObject({ manifestUrl: z.url() }),
    output: InstallPreviewSummarySchema
  }),
  /** A shipped tree under `resources/`, read in place; the card and the confirm route are the file source's. */
  'mini_app.install.preview_builtin': defineRoute({ input: AppIdInputSchema, output: InstallPreviewSummarySchema }),
  /**
   * Token only — never a path or an id (TOCTOU: the bytes must be the ones reviewed).
   * `grantedOptional` = the optional leaves left ticked on the card; omitted = all of them.
   * `reinstall` is REQUIRED when the preview carried `installed` — the card's answer to it.
   */
  'mini_app.install.confirm': defineRoute({
    input: z.strictObject({
      installToken: z.string().min(1),
      grantedOptional: z.array(z.string()).optional(),
      reinstall: z.strictObject({ clearData: z.boolean() }).optional()
    }),
    output: LocalMiniAppSchema
  }),
  'mini_app.install.cancel_preview': defineRoute({
    input: z.strictObject({ installToken: z.string().min(1) }),
    output: z.void()
  }),

  // Update flow: check → apply by token → rollback.
  /** Only checks; applying is always the explicit `mini_app.update.apply` with the token. */
  'mini_app.update.check': defineRoute({ input: AppIdInputSchema, output: UpdateStatusSchema }),
  /** Same, gated by the global `feature.mini_app.check_updates_on_open` preference; fired by the webview after prepare. */
  'mini_app.update.check_on_open': defineRoute({ input: AppIdInputSchema, output: UpdateStatusSchema }),
  /** Token only — never a manifest or version (TOCTOU: the bytes must be the ones reviewed). */
  'mini_app.update.apply': defineRoute({
    input: z.strictObject({
      appId: MiniAppIdSchema,
      updateToken: z.string().min(1),
      consented: z.boolean().optional(),
      /** The newly offered optional leaves left ticked; omitted = all of them. */
      grantedOptional: z.array(z.string()).optional()
    }),
    output: z.void()
  }),
  'mini_app.update.rollback': defineRoute({ input: AppIdInputSchema, output: z.void() }),

  // Permission grants.
  /** OPTIONAL leaves only — the owner refuses a required one. */
  'mini_app.grant.approve': defineRoute({ input: PermissionInputSchema, output: z.void() }),
  'mini_app.grant.revoke': defineRoute({ input: PermissionInputSchema, output: z.void() }),
  /** Grants the leaves a Cherry update added under a declared wildcard (decision A). */
  'mini_app.grant.approve_pending': defineRoute({ input: AppIdInputSchema, output: z.void() }),
  /** "Not now": silences the dot for those leaves until the next launch; grants nothing, the panel still offers them. */
  'mini_app.grant.snooze_pending': defineRoute({ input: AppIdInputSchema, output: z.void() }),

  // Per-app settings that are not plain columns (`aiModelId` goes through `PATCH /mini-apps/:appId`).
  'mini_app.settings.set_logo': defineRoute({
    input: z.strictObject({ appId: MiniAppIdSchema, image: LogoImageIntentSchema }),
    output: z.void()
  }),

  // Runtime: the webview host handshake and the attention badge.
  'mini_app.runtime.prepare': defineRoute({
    input: z.object({ appId: MiniAppIdSchema }),
    output: z.void()
  }),
  /** Pull half of the attention badge — a window opened after the broadcast never saw it. */
  'mini_app.runtime.attention_state': defineRoute({ input: z.void(), output: z.array(MiniAppAttentionSchema) }),
  /** The pool's pane state for one app in the calling window — the source of the guest's `app.visibilityChange`. */
  'mini_app.runtime.set_visible': defineRoute({
    input: z.object({ appId: MiniAppIdSchema, visible: z.boolean() }),
    output: z.void()
  }),

  // Activity log: the detail panel's "what did this app do" — newest first, no payloads.
  'mini_app.activity.list': defineRoute({
    input: z.object({
      appId: MiniAppIdSchema,
      limit: z.number().int().min(1).max(500).default(100),
      deniedOnly: z.boolean().default(false)
    }),
    output: MiniAppActivityListingSchema
  }),
  'mini_app.activity.clear': defineRoute({ input: AppIdInputSchema, output: z.void() }),
  /** Opens the app's log folder in the system file manager. */
  'mini_app.activity.open_folder': defineRoute({ input: AppIdInputSchema, output: z.void() })
}

export type MiniAppEventSchemas = {
  /** Apps that want the user's attention, and why (a host-added permission, or an update). */
  'mini_app.runtime.attention': { apps: CacheMiniAppAttention[] }
  /** Host is about to change this app underneath it; drop it from every pool. */
  'mini_app.runtime.evicted': { appId: string }
}
