import * as z from 'zod'

import { UniqueModelIdSchema } from '@shared/data/types/model'
import {
  DEEPSEEK_HARNESS_AGENT_PRESETS,
  DEEPSEEK_HARNESS_PERMISSION_MODES,
  DEFAULT_DEEPSEEK_HARNESS_SETTINGS
} from '@shared/types/codeCli'

import { defineRoute } from '../define'
import { operationResultSchema } from './common'

const deepSeekHarnessStatusSchema = z.enum(['stopped', 'starting', 'running', 'error'])

export const deepSeekHarnessRequestSchemas = {
  'deepseek_harness.start': defineRoute({
    input: z
      .object({
        mode: z.enum(['direct', 'gateway']),
        uniqueModelId: UniqueModelIdSchema,
        agentPreset: z.enum(DEEPSEEK_HARNESS_AGENT_PRESETS).default(DEFAULT_DEEPSEEK_HARNESS_SETTINGS.agentPreset),
        permissionMode: z
          .enum(DEEPSEEK_HARNESS_PERMISSION_MODES)
          .default(DEFAULT_DEEPSEEK_HARNESS_SETTINGS.permissionMode)
      })
      .strict(),
    output: z.discriminatedUnion('success', [
      z.object({ success: z.literal(true), url: z.string().url() }),
      z.object({ success: z.literal(false), message: z.string() })
    ])
  }),
  'deepseek_harness.stop': defineRoute({
    input: z.void(),
    output: operationResultSchema
  }),
  'deepseek_harness.get_status': defineRoute({
    input: z.void(),
    output: z.object({ status: deepSeekHarnessStatusSchema, url: z.string().url().optional() })
  })
}

// ── Event schemas ──
export type DeepSeekHarnessEventSchemas = {
  /** Fired on every status transition; payload is identical in shape to get_status. */
  'deepseek_harness.status_changed': { status: z.infer<typeof deepSeekHarnessStatusSchema>; url?: string }
}
