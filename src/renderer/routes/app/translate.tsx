import { createFileRoute } from '@tanstack/react-router'

import TranslatePage from '@renderer/pages/translate/TranslatePage'

export const Route = createFileRoute('/app/translate')({
  component: TranslatePage
})
