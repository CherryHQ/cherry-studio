import { createFileRoute, redirect } from '@tanstack/react-router'

import UarSettings from '@renderer/pages/settings/PrometheusSettings/UarSettings'
import { isUarEnabled } from '@shared/ai/agentRuntimeCapabilities'

type UarSettingsSearch = {
  panel?: string
  focusId?: string
  agentId?: string
}

export const Route = createFileRoute('/settings/uar')({
  beforeLoad: () => {
    if (!isUarEnabled()) throw redirect({ to: '/settings/prometheus' })
  },
  component: UarSettings,
  validateSearch: (search: Record<string, unknown>): UarSettingsSearch => ({
    ...(typeof search.panel === 'string' ? { panel: search.panel } : {}),
    ...(typeof search.focusId === 'string' ? { focusId: search.focusId } : {}),
    ...(typeof search.agentId === 'string' ? { agentId: search.agentId } : {})
  })
})
