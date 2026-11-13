import { createFileRoute } from '@tanstack/react-router'

import { BrowserPage } from '@renderer/pages/browser/BrowserPage'
import { normalizeBrowserEntryUrl } from '@shared/utils/browserUrl'

export const Route = createFileRoute('/app/browser')({
  validateSearch: (search): { url?: string } => {
    // TanStack merges validated search into raw params, so absence must override the raw URL.
    if (typeof search.url !== 'string' || !search.url.trim()) return { url: undefined }
    return {
      url: search.url === 'about:blank' ? 'about:blank' : normalizeBrowserEntryUrl(search.url)
    }
  },
  component: BrowserRoute
})

function BrowserRoute() {
  const { url } = Route.useSearch()
  return <BrowserPage initialUrl={url} />
}
