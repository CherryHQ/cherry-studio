import { createFileRoute } from '@tanstack/react-router'

import CompassSettings from '@renderer/pages/settings/PrometheusSettings/CompassSettings'

export const Route = createFileRoute('/settings/compass')({ component: CompassSettings })
