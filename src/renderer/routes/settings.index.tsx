import { createFileRoute, redirect } from '@tanstack/react-router'

import { DEFAULT_SETTINGS_PATH } from '@shared/data/types/settingsPath'

export const Route = createFileRoute('/settings/')({
  beforeLoad: () => {
    throw redirect({ to: DEFAULT_SETTINGS_PATH })
  }
})
