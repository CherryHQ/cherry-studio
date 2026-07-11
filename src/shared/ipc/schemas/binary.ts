import type { ManagedBinary } from '@shared/data/preference/preferenceTypes'
import { TOOL_NAME_RE } from '@shared/data/presets/binaryTools'
import type { BinaryResolution } from '@shared/types/binary'
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
 * install spec lives in `BinaryManager.installTool` (validateManagedBinary); the
 * schema only guards the wire shape, per the schema guide.
 */

/** Structural shape of {@link ManagedBinary}; deep validation is the service's job. */
const managedBinarySchema: z.ZodType<ManagedBinary> = z.object({
  name: z.string(),
  tool: z.string(),
  version: z.string().optional()
})

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

// ── Request: renderer→main calls (zod values, always parsed) ──
export const binaryRequestSchemas = {
  'binary.install_tool': defineRoute({ input: managedBinarySchema, output: z.object({ version: z.string() }) }),
  'binary.remove_tool': defineRoute({ input: toolNameSchema, output: z.void() }),
  'binary.resolve_tools': defineRoute({
    input: z.array(toolNameSchema),
    output: z.record(z.string(), binaryResolutionSchema)
  }),
  'binary.search_registry': defineRoute({ input: z.string(), output: z.array(registryEntrySchema) }),
  // false = read session shared cache only; true = run mise latest and refresh the cache.
  'binary.get_latest_versions': defineRoute({ input: z.boolean(), output: z.record(z.string(), z.string()) })
}

// ── Event: main→renderer pushes (pure types, never parsed) ──
export type BinaryEventSchemas = {
  // Availability may have changed — consumers re-resolve the tools they display.
  'binary.availability_changed': void
  // Comma-joined names of tools that failed the boot-time reconcile.
  'binary.reconcile_failed': string
}
