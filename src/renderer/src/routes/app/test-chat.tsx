import TestChat from '@renderer/pages/test-chat/TestChat'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/test-chat')({
  component: TestChat
})
