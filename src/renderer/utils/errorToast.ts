import type { ToastType } from '@cherrystudio/ui'
import type { SerializedError } from '@renderer/types/error'
import { serializeHealthCheckError } from '@renderer/utils/error'
import { aiErrorDetail } from '@shared/ipc/errors/ai'
import type { ErrorCategory } from '@shared/utils/errorCategory'

export type ErrorToastAction = 'configure' | 'billing' | 'retry' | 'trimContext' | 'switchModel' | 'mcp'

export interface ErrorToastPresentation {
  type: Extract<ToastType, 'error' | 'warning' | 'info'>
  action?: ErrorToastAction
}

export const errorToastPresentations: Record<ErrorCategory, ErrorToastPresentation> = {
  auth: { type: 'warning', action: 'configure' },
  bad_request: { type: 'warning' },
  permission: { type: 'warning' },
  region: { type: 'warning' },
  model: { type: 'warning', action: 'switchModel' },
  quota: { type: 'warning', action: 'billing' },
  rate_limit: { type: 'info', action: 'retry' },
  context_length: { type: 'warning', action: 'trimContext' },
  payload: { type: 'warning' },
  network: { type: 'info', action: 'retry' },
  proxy: { type: 'info', action: 'retry' },
  stream: { type: 'info', action: 'retry' },
  content: { type: 'warning' },
  server: { type: 'info', action: 'retry' },
  deprecated: { type: 'warning', action: 'switchModel' },
  knowledge: { type: 'warning' },
  ocr: { type: 'warning' },
  mcp: { type: 'warning', action: 'mcp' },
  parse: { type: 'warning' },
  unknown: { type: 'error' }
}

export function serializeToastError(error: unknown): SerializedError {
  const detail = aiErrorDetail(error)
  if (detail) return detail
  const serialized = serializeHealthCheckError(error)
  if (typeof error !== 'object' || error === null) return serialized
  // Keep structured provider categories/status and retry wrappers lost by generic Error serialization.
  return {
    ...error,
    ...serialized,
    message: 'message' in error && typeof error.message === 'string' ? error.message : serialized.message
  }
}
