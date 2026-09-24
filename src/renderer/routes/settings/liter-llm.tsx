import { createFileRoute } from '@tanstack/react-router'

import LiterLlmSettings from '@renderer/pages/settings/PrometheusSettings/LiterLlmSettings'

export const Route = createFileRoute('/settings/liter-llm')({ component: LiterLlmSettings })
