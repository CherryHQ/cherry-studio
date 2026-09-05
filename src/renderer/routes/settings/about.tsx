import { AboutSettings } from '@renderer/pages/settings/AboutSettings'
import { DOCTOR_OPEN_QUERY_PARAM, type DoctorPanel } from '@shared/types/doctor'
import { createFileRoute } from '@tanstack/react-router'

function isDoctorPanel(value: unknown): value is DoctorPanel {
  return value === 'checks' || value === 'export' || value === 'report'
}

export const Route = createFileRoute('/settings/about')({
  component: AboutSettings,
  validateSearch: (search: Record<string, unknown>) => {
    const validated = { ...search }
    if (!isDoctorPanel(validated[DOCTOR_OPEN_QUERY_PARAM])) {
      delete validated[DOCTOR_OPEN_QUERY_PARAM]
    }
    return validated
  }
})
