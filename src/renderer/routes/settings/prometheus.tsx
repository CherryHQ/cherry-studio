import { createFileRoute } from '@tanstack/react-router'

import PrometheusSettings from '@renderer/pages/settings/PrometheusSettings/PrometheusSettings'

export const Route = createFileRoute('/settings/prometheus')({
  component: PrometheusSettings
})
