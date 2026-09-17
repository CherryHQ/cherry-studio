import { createFileRoute } from '@tanstack/react-router'

import VideoPage from '@renderer/pages/videos/VideoPage'

export const Route = createFileRoute('/app/videos/')({
  component: VideoPage
})
