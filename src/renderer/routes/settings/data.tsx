import { createFileRoute } from '@tanstack/react-router'

import { dataPanelSearchSchema } from '@renderer/pages/settings/DataSettings/dataPanels'
import DataSettings from '@renderer/pages/settings/DataSettings/DataSettings'

export const Route = createFileRoute('/settings/data')({
  component: DataSettings,
  // Invalid panel values degrade to no param (default panel) rather than throwing
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Panel query values are unvalidated until dataPanelSearchSchema accepts them; unrelated keys are stripped there.
  validateSearch: (search: Record<string, unknown>) => {
    const parsed = dataPanelSearchSchema.safeParse(search)

    return parsed.success ? parsed.data : {}
  }
})
