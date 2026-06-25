import HomePage from '@renderer/pages/home/HomePage'
import { parseChatRouteSearch } from '@renderer/pages/home/routeSearch'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/chat')({
  validateSearch: (search) => parseChatRouteSearch(search),
  component: HomePage
})
