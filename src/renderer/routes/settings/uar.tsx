import { createFileRoute } from '@tanstack/react-router'

import UarSettings from '@renderer/pages/settings/PrometheusSettings/UarSettings'

type UarSettingsSearch = {
  panel?: string
  focusId?: string
}

export const Route = createFileRoute('/settings/uar')({
  component: UarSettings,
  validateSearch: (search: Record<string, unknown>): UarSettingsSearch => ({
    ...(typeof search.panel === 'string' ? { panel: search.panel } : {}),
    ...(typeof search.focusId === 'string' ? { focusId: search.focusId } : {})
  })
})
