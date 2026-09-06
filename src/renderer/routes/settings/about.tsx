import { AboutSettings } from '@renderer/pages/settings/AboutSettings'
import { DOCTOR_OPEN_QUERY_PARAM, type DoctorPanel } from '@shared/types/doctor'
import { createFileRoute } from '@tanstack/react-router'

const DOCTOR_PANEL_VALUES = {
  checks: true,
  export: true,
  report: true
} as const satisfies Record<DoctorPanel, true>

function isDoctorPanel(value: unknown): value is DoctorPanel {
  return typeof value === 'string' && Object.hasOwn(DOCTOR_PANEL_VALUES, value)
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
