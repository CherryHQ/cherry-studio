import { createFileRoute } from '@tanstack/react-router'

import { BrowserPage } from '@renderer/pages/browser/BrowserPage'
import { normalizeBrowserEntryUrl } from '@shared/utils/browserUrl'

export const Route = createFileRoute('/app/browser')({
  validateSearch: (search): { url: string } => ({
    url:
      typeof search.url !== 'string' || !search.url.trim() || search.url === 'about:blank'
        ? 'about:blank'
        : normalizeBrowserEntryUrl(search.url)
  }),
  component: BrowserRoute
})

function BrowserRoute() {
  const { url } = Route.useSearch()
  return <BrowserPage initialUrl={url} />
}
