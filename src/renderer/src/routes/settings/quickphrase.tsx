import QuickPhraseSettings from '@renderer/pages/settings/QuickPhraseSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/quickphrase')({
  component: QuickPhraseSettings
})
