import { createFileRoute } from '@tanstack/react-router'

import { BrowserPage } from '@renderer/pages/browser/BrowserPage'
import { normalizeBrowserEntryUrl } from '@shared/utils/browserUrl'

export const Route = createFileRoute('/app/browser')({
  validateSearch: (search): { url?: string } => {
    // oxlint-disable-next-line anti-slop/no-known-value-widening -- Keep url optional for navigation while overriding invalid raw search values with undefined.
    if (typeof search.url !== 'string' || !search.url.trim()) return { url: undefined }
    // oxlint-disable-next-line anti-slop/no-known-value-widening -- TanStack navigation may omit url; the validated result still overrides the raw query value.
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
