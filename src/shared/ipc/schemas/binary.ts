import type { BinaryManifestEntry } from '@shared/data/preference/preferenceTypes'
import { TOOL_NAME_RE } from '@shared/data/presets/binaryTools'
import type {
  BinaryAvailability,
  BinaryInstallRequest,
  BinaryOperation,
  BinaryResolution,
  BinaryToolInventoryEntry,
  BinaryToolSnapshot
} from '@shared/types/binary'
import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * BinaryManager IPC schemas — CLI binary acquisition (install/remove/query) driven
 * by the renderer's Environment Dependencies settings.
 *
 * Two blocks per the framework's two-axis model (see ipc-overview.md):
 *   - Request schemas are zod *values* (renderer→main, untrusted → always parsed).
 *   - Event schemas are pure *types* (main→renderer, main is the TCB → not parsed).
 *
 * SECURITY: install_tool can install arbitrary npm:/pipx: packages (postinstall =
 * code execution), so reaching these routes must stay gated by IpcApi's
 * source-trust check (validateSender). The deep grammar/length validation of the
 * install spec lives in `BinaryManager.installTool` (validateBinaryManifestEntry); the
 * schema only guards the wire shape, per the schema guide.
 */

/**
 * A tool name used purely to address an existing entry (remove / open dir). The
 * legacy handlers gated these on TOOL_NAME_RE before doing anything; keep that as
 * the wire contract so a malformed name is rejected at the boundary.
 */
const toolNameSchema = z.string().regex(TOOL_NAME_RE)

const binaryResolutionSchema: z.ZodType<BinaryResolution> = z.discriminatedUnion('source', [
  z.object({ source: z.literal('managed'), path: z.string(), version: z.string() }),
  z.object({ source: z.literal('bundled'), path: z.string(), version: z.string().optional() }),
  z.object({ source: z.literal('system'), path: z.string() }),
  z.object({ source: z.literal('none') })
])

const registryEntrySchema = z.object({ name: z.string(), tool: z.string() })

const binaryToolInventoryEntrySchema: z.ZodType<BinaryToolInventoryEntry> = z.discriminatedUnion('managed', [
  z.object({
    name: z.string(),
    tool: z.string(),
    version: z.string(),
    requestedVersion: z.string().optional(),
    managed: z.literal(true)
  }),
  z.object({ name: z.string(), tool: z.string(), version: z.string(), managed: z.literal(false) })
])

/** Durable management intent stored in the BinaryManager-owned Preference manifest. */
export const binaryManifestEntrySchema: z.ZodType<BinaryManifestEntry> = z.object({
  name: z.string(),
  tool: z.string(),
  requestedVersion: z.string().optional()
})

/** Install route input: durable intent plus an optional one-shot target. */
export const binaryInstallRequestSchema: z.ZodType<BinaryInstallRequest> = z.object({
  intent: binaryManifestEntrySchema,
  targetVersion: z.string().optional()
})

export const binaryAvailabilitySchema: z.ZodType<BinaryAvailability> = z.discriminatedUnion('source', [
  z.object({ source: z.literal('mise'), tool: z.string(), path: z.string(), version: z.string().optional() }),
  z.object({ source: z.literal('bundled'), path: z.string(), version: z.string().optional() }),
  z.object({ source: z.literal('system'), path: z.string() }),
  z.object({ source: z.literal('none') })
])

export const binaryOperationSchema: z.ZodType<BinaryOperation> = z.discriminatedUnion('status', [
  z.object({ status: z.literal('installing') }),
  z.object({ status: z.literal('removing') }),
  z.object({
    status: z.literal('failed'),
    action: z.enum(['install', 'remove']),
    error: z.string(),
    intent: binaryManifestEntrySchema.optional()
  })
])

/** Future snapshot route output; intentionally standalone until the route is added. */
export const binaryToolSnapshotSchema: z.ZodType<BinaryToolSnapshot> = z.object({
  name: z.string(),
  intent: binaryManifestEntrySchema.optional(),
  availability: binaryAvailabilitySchema,
  operation: binaryOperationSchema.optional()
})

// ── Request: renderer→main calls (zod values, always parsed) ──
export const binaryRequestSchemas = {
  'binary.install_tool': defineRoute({ input: binaryInstallRequestSchema, output: z.object({ version: z.string() }) }),
  'binary.remove_tool': defineRoute({ input: toolNameSchema, output: z.void() }),
  'binary.resolve_tools': defineRoute({
    input: z.array(toolNameSchema),
    output: z.record(z.string(), binaryResolutionSchema)
  }),
  'binary.search_registry': defineRoute({ input: z.string(), output: z.array(registryEntrySchema) }),
  // false = read session shared cache only; true = run mise latest and refresh the cache.
  'binary.get_latest_versions': defineRoute({ input: z.boolean(), output: z.record(z.string(), z.string()) }),
  // Manifest entries are manageable; only unrecorded node/python runtimes from
  // live `mise ls` are included as display-only entries.
  'binary.list_tools': defineRoute({ input: z.void(), output: z.array(binaryToolInventoryEntrySchema) }),
  // Whether a CLI tool binary is resolvable (bundled or on PATH). Legacy App_IsBinaryExist.
  'binary.is_installed': defineRoute({ input: z.string(), output: z.boolean() })
}

// ── Event: main→renderer pushes (pure types, never parsed) ──
export type BinaryEventSchemas = {
  // Availability may have changed — consumers re-resolve the tools they display.
  'binary.availability_changed': void
  // Comma-joined names of tools that failed the boot-time reconcile.
  'binary.reconcile_failed': string
}
