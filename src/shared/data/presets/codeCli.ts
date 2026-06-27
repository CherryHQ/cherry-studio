/**
 * Code CLI preset definitions
 *
 * Defines the list of supported CLI coding tools. Each tool holds a set of
 * named configs (`CodeCliToolState`) stored via the preference key
 * `feature.code_cli.configs`. Schemas here validate the runtime preference
 * value; per-config model/api params are resolved from Cherry's provider data
 * at "enable config" time (see `renderer/services/codeCli.ts`).
 */

import { CODE_CLI_IDS } from '@shared/data/preference/preferenceTypes'
import * as z from 'zod'

export const CodeCliIdSchema = z.enum(CODE_CLI_IDS)

/** A named CLI provider config. */
export const CliNamedConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  providerId: z.string(),
  modelId: z.string(),
  config: z.record(z.string(), z.unknown()).optional(),
  directory: z.string().optional(),
  createdAt: z.number().optional(),
  sortIndex: z.number().optional(),
  notes: z.string().optional(),
  icon: z.string().optional(),
  iconColor: z.string().optional()
})

/** Per-CLI-tool state. */
export const CodeCliToolStateSchema = z.object({
  providers: z.record(z.string(), CliNamedConfigSchema),
  current: z.string().nullable(),
  terminal: z.string().optional(),
  directories: z.array(z.string()).optional()
})

/** Full preference value. */
export const CodeCliConfigsSchema = z.record(CodeCliIdSchema, CodeCliToolStateSchema)
