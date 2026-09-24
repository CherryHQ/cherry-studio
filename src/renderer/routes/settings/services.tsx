import { createFileRoute } from '@tanstack/react-router'

import ServicesSettings from '@renderer/pages/settings/PrometheusSettings/ServicesSettings'

export const Route = createFileRoute('/settings/services')({ component: ServicesSettings })
