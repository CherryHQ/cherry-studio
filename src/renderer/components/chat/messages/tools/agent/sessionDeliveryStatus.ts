import type { AgentSessionDeliveryStatus } from '@shared/ai/agentSessionDelivery'
import type { TFunction } from 'i18next'

const DELIVERY_STATUS_LABEL_KEYS = {
  accepted: 'agent.session_delivery.status.accepted',
  consumed: 'agent.session_delivery.status.consumed',
  delivering: 'agent.session_delivery.status.delivering',
  failed: 'agent.session_delivery.status.failed'
} as const

const DELIVERY_STATUS_CLASS_NAMES: Record<AgentSessionDeliveryStatus, string> = {
  accepted: 'border-info-border bg-info-subtle text-info-subtle-foreground',
  consumed: 'border-success-border bg-success-subtle text-success-subtle-foreground',
  delivering: 'border-info-border bg-info-subtle text-info-subtle-foreground',
  failed: 'border-error-border bg-error-subtle text-error-subtle-foreground'
}

export function getSessionDeliveryStatus(status: string | undefined, t: TFunction) {
  if (status && Object.hasOwn(DELIVERY_STATUS_LABEL_KEYS, status)) {
    const deliveryStatus = status as AgentSessionDeliveryStatus
    return {
      className: DELIVERY_STATUS_CLASS_NAMES[deliveryStatus],
      label: t(DELIVERY_STATUS_LABEL_KEYS[deliveryStatus])
    }
  }

  return {
    className: DELIVERY_STATUS_CLASS_NAMES.accepted,
    label: t('message.tools.pending')
  }
}
