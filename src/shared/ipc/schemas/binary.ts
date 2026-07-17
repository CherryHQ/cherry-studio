import type { BinaryManifestEntry } from '@shared/data/preference/preferenceTypes'
import { TOOL_NAME_RE } from '@shared/data/presets/binaryTools'
import type {
  BinaryApplication,
  BinaryAvailability,
  BinaryInstallRequest,
  BinaryOperation,
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

/** A tool name used to address an existing entry; reject malformed names at the boundary. */
const toolNameSchema = z.string().regex(TOOL_NAME_RE)

const registryEntrySchema = z.object({ name: z.string(), tool: z.string() })

/** Durable management intent stored in the BinaryManager-owned Preference manifest. */
const binaryManifestEntrySchema: z.ZodType<BinaryManifestEntry> = z.object({
  name: z.string(),
  tool: z.string(),
  requestedVersion: z.string().optional()
})

/** Install route input: durable intent plus an optional one-shot target. */
const binaryInstallRequestSchema: z.ZodType<BinaryInstallRequest> = z.object({
  intent: binaryManifestEntrySchema,
  targetVersion: z.string().optional()
})

const binaryAvailabilitySchema: z.ZodType<BinaryAvailability> = z.discriminatedUnion('source', [
  z.object({ source: z.literal('mise'), tool: z.string(), path: z.string(), version: z.string().optional() }),
  z.object({ source: z.literal('bundled'), path: z.string(), version: z.string().optional() }),
  z.object({ source: z.literal('system'), path: z.string() }),
  z.object({ source: z.literal('none') })
])

const binaryApplicationSchema: z.ZodType<BinaryApplication> = z.discriminatedUnion('status', [
  z.object({ status: z.literal('applied'), version: z.string().optional() }),
  z.object({ status: z.literal('broken'), version: z.string().optional() }),
  z.object({ status: z.literal('absent') }),
  z.object({ status: z.literal('conflict') }),
  z.object({ status: z.literal('unknown'), reason: z.enum(['backend_unavailable', 'query_failed']) })
])

const binaryOperationSchema: z.ZodType<BinaryOperation> = z.discriminatedUnion('status', [
  z.object({ status: z.literal('installing') }),
  z.object({ status: z.literal('removing') }),
  z.object({
    status: z.literal('failed'),
    action: z.enum(['install', 'remove']),
    error: z.string(),
    intent: binaryManifestEntrySchema.optional()
  })
])

const binaryToolSnapshotSchema: z.ZodType<BinaryToolSnapshot> = z.object({
  name: z.string(),
  intent: binaryManifestEntrySchema.optional(),
  availability: binaryAvailabilitySchema,
  application: binaryApplicationSchema.optional(),
  operation: binaryOperationSchema.optional()
})

// ── Request: renderer→main calls (zod values, always parsed) ──
export const binaryRequestSchemas = {
  'binary.install_tool': defineRoute({ input: binaryInstallRequestSchema, output: z.object({ version: z.string() }) }),
  'binary.remove_tool': defineRoute({ input: toolNameSchema, output: z.void() }),
  'binary.get_tool_snapshots': defineRoute({
    input: z.array(toolNameSchema),
    output: z.record(z.string(), binaryToolSnapshotSchema)
  }),
  'binary.search_registry': defineRoute({ input: z.string(), output: z.array(registryEntrySchema) }),
  // false = read session shared cache only; true = run mise latest and refresh the cache.
  'binary.get_latest_versions': defineRoute({ input: z.boolean(), output: z.record(z.string(), z.string()) })
}

// ── Event: main→renderer pushes (pure types, never parsed) ──
export type BinaryEventSchemas = {
  // Availability may have changed — consumers re-resolve the tools they display.
  'binary.availability_changed': void
}
