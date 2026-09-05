import { dataPanelSearchSchema } from '@renderer/pages/settings/DataSettings/dataPanels'
import DataSettings from '@renderer/pages/settings/DataSettings/DataSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/data')({
  component: DataSettings,
  // Invalid panel values degrade to no param (default panel) rather than throwing
  validateSearch: (search: Record<string, unknown>) => {
    const parsed = dataPanelSearchSchema.safeParse(search)
    return parsed.success ? parsed.data : {}
  }
})
