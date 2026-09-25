import { createFileRoute } from '@tanstack/react-router'

import { LabsSettings } from '@renderer/pages/settings/LabsSettings'

export const Route = createFileRoute('/settings/labs')({ component: LabsSettings })
