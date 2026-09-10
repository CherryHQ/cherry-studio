import { parseTranslateRouteSearch } from '@renderer/pages/translate/routeSearch'
import TranslatePage from '@renderer/pages/translate/TranslatePage'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { v4 as uuid } from 'uuid'

export const Route = createFileRoute('/app/translate')({
  validateSearch: (search) => parseTranslateRouteSearch(search),
  // The page's draft and its in-flight stream are keyed by this id, so the page must never
  // render without one. Minting here rather than in the page keeps the id out of render-time
  // side effects, and makes leaving the route end the session for free: the sidebar rewrites
  // the tab url to the bare path, so the old id stops being reachable and gets swept.
  beforeLoad: ({ search }) => {
    if (search.tabSession) return
    throw redirect({ to: '/app/translate', search: { tabSession: uuid() }, replace: true })
  },
  component: TranslatePage
})
