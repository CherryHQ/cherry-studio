import { isAgentSessionTopic } from '@shared/ai/agentSessionTopic'
import { AGENT_BUSY_SEND_MODES } from '@shared/ai/transport'
import { DataApiErrorFactory } from '@shared/data/api/errors'

import type { MainDispatchRequest } from './dispatch'

/**
 * Enforces boundary invariants for explicit `busyMode` requests before provider preparation or
 * interrupt admission runs.
 */
export function assertBusyModeBoundary(req: MainDispatchRequest): void {
  if (!('busyMode' in req) || req.busyMode === undefined) return
  if (!isAgentSessionTopic(req.topicId)) {
    throw DataApiErrorFactory.invalidOperation('busyMode is only supported for Agent sessions')
  }
  if (req.trigger !== 'submit-message') {
    throw DataApiErrorFactory.invalidOperation(`busyMode requires 'submit-message' (got '${req.trigger}')`)
  }
  if (!AGENT_BUSY_SEND_MODES.includes(req.busyMode)) {
    throw DataApiErrorFactory.invalidOperation(`Unsupported busyMode: ${String(req.busyMode)}`)
  }
  if (req.followUp !== undefined) {
    throw DataApiErrorFactory.invalidOperation('busyMode and followUp cannot be combined')
  }
  if (req.headless === true) {
    throw DataApiErrorFactory.invalidOperation('busyMode is not supported for headless dispatches')
  }
  if (req.agentDeliveryMessage !== undefined) {
    throw DataApiErrorFactory.invalidOperation('busyMode is not supported for durable delivery messages')
  }
}
