import type { BinaryState, ManagedBinary } from '@shared/data/preference/preferenceTypes'
import { TOOL_NAME_RE } from '@shared/data/presets/binaryTools'
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

const binaryStateSchema: z.ZodType<BinaryState> = z.object({
  tools: z.record(z.string(), z.object({ tool: z.string(), version: z.string() }))
})

const registryEntrySchema = z.object({ name: z.string(), tool: z.string() })

// ── Request: renderer→main calls (zod values, always parsed) ──
export const binaryRequestSchemas = {
  'binary.install_tool': defineRoute({ input: managedBinarySchema, output: z.object({ version: z.string() }) }),
  'binary.remove_tool': defineRoute({ input: toolNameSchema, output: z.void() }),
  'binary.get_state': defineRoute({ input: z.void(), output: binaryStateSchema }),
  'binary.search_registry': defineRoute({ input: z.string(), output: z.array(registryEntrySchema) }),
  'binary.get_tool_dir': defineRoute({ input: toolNameSchema, output: z.string() }),
  'binary.probe_bundled': defineRoute({ input: z.void(), output: z.record(z.string(), z.string().nullable()) })
}

// ── Event: main→renderer pushes (pure types, never parsed) ──
export type BinaryEventSchemas = {
  // Latest persisted install state — broadcast to all windows after every install/remove.
  'binary.state_changed': BinaryState
  // Comma-joined names of tools that failed the boot-time reconcile.
  'binary.reconcile_failed': string
}
