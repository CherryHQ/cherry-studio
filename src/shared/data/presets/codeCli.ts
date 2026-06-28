/**
 * Code CLI preset definitions
 *
 * Defines the list of supported CLI coding tools. Each tool holds a set of
 * per-provider configs (`CodeCliToolState`) stored via the preference key
 * `feature.code_cli.configs`. Schemas here validate the runtime preference
 * value; per-provider model/api params are resolved from Cherry's provider
 * data at "enable" time (see `renderer/services/codeCli.ts`).
 */

import { CODE_CLI_IDS } from '@shared/data/preference/preferenceTypes'
import * as z from 'zod'

export const CodeCliIdSchema = z.enum(CODE_CLI_IDS)

/** A CLI provider config, keyed by providerId. */
export const CliProviderConfigSchema = z.object({
  modelId: z.string(),
  config: z.record(z.string(), z.unknown()).optional(),
  directory: z.string().optional(),
  createdAt: z.number().optional()
})

/** Per-CLI-tool state. */
export const CodeCliToolStateSchema = z.object({
  providers: z.record(z.string(), CliProviderConfigSchema),
  current: z.string().nullable(),
  providerOrder: z.array(z.string()).optional(),
  terminal: z.string().optional(),
  directories: z.array(z.string()).optional()
})

/** Full preference value. */
export const CodeCliConfigsSchema = z.record(CodeCliIdSchema, CodeCliToolStateSchema)
