import type { AiUsageRecordAuthMethod } from '@shared/data/types/aiUsageRecord'

/**
 * Non-secret receipt captured by the component that selected the serving
 * credential. The raw credential never crosses into usage persistence.
 */
export type AiUsageCredentialReceipt =
  | {
      attribution: 'explicit' | 'matched'
      id: string
      label?: string
      masked: string
    }
  | { attribution: 'auth'; method: AiUsageRecordAuthMethod }
  | { attribution: 'unknown' }

/**
 * Agent-session usage has exactly one capture owner per runtime route.
 *
 * Direct/external routes are recorded from the final agent message; gateway
 * routes retain their provider-call records and suppress the cumulative message
 * record so those calls are not counted twice.
 */
export type AgentSessionUsageCapture =
  | { owner: 'agent-message'; credentialReceipt: AiUsageCredentialReceipt }
  | { owner: 'provider-requests' }
