import { createFileRoute } from '@tanstack/react-router'

import UarSettings from '@renderer/pages/settings/PrometheusSettings/UarSettings'

export const Route = createFileRoute('/settings/uar')({ component: UarSettings })
