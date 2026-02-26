/**
 * OVMS (OpenVINO Model Server) Config API Response Schema
 * Endpoint: GET /config
 */
import * as z from 'zod'

// OVMS model version status
export const OVMSVersionStatusSchema = z.object({
  state: z.string(),
  status: z
    .object({
      error_code: z.string().optional(),
      error_message: z.string().optional()
    })
    .optional()
})

// Single OVMS model entry (dynamic key)
export const OVMSModelEntrySchema = z.object({
  model_version_status: z.array(OVMSVersionStatusSchema).optional()
})

// OVMS config response - record of model names to their configs
export const OVMSConfigResponseSchema = z.record(z.string(), OVMSModelEntrySchema)

// Types derived from schemas
export type OVMSVersionStatus = z.infer<typeof OVMSVersionStatusSchema>
export type OVMSModelEntry = z.infer<typeof OVMSModelEntrySchema>
export type OVMSConfigResponse = z.infer<typeof OVMSConfigResponseSchema>
