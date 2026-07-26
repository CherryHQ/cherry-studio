import { UniqueModelIdSchema } from '@shared/data/types/model'
import * as z from 'zod'

import { defineRoute } from '../define'
import { operationResultSchema } from './common'

/**
 * OpenClaw gateway runtime schemas.
 * Install/update goes renderer → binary.install_tool (name-only) → BinaryManager,
 * which resolves the fixed recipe itself.
 */

// ── Request schemas ──
export const openclawRequestSchemas = {
  'openclaw.start_gateway': defineRoute({
    input: z.object({ port: z.number().int().min(1).max(65535).optional() }),
    output: operationResultSchema
  }),
  'openclaw.stop_gateway': defineRoute({
    input: z.void(),
    output: operationResultSchema
  }),
  'openclaw.get_status': defineRoute({
    input: z.void(),
    output: z.object({ status: z.enum(['stopped', 'starting', 'running', 'error']) })
  }),
  'openclaw.get_dashboard_url': defineRoute({
    input: z.void(),
    output: z.string()
  }),
  'openclaw.sync_config': defineRoute({
    input: z.object({ uniqueModelId: UniqueModelIdSchema, port: z.number().optional() }),
    output: operationResultSchema
  })
}
