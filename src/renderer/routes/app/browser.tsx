import { BrowserPage } from '@renderer/pages/browser/BrowserPage'
import { normalizeBrowserEntryUrl } from '@shared/utils/browserUrl'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/browser')({
  validateSearch: (search): { url: string } => ({
    url: normalizeBrowserEntryUrl(typeof search.url === 'string' ? search.url : '')
  }),
  component: BrowserRoute
})

function BrowserRoute() {
  const { url } = Route.useSearch()
  return <BrowserPage initialUrl={url} />
}
