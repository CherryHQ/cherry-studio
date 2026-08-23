import { SETTINGS_SEARCH_QUERY_MAX_BYTES } from '@renderer/pages/settings/settingsSearch/searchEngine'
import { SearchResultsPage } from '@renderer/pages/settings/settingsSearch/SearchResultsPage'
import { createFileRoute } from '@tanstack/react-router'
import * as z from 'zod'

// Invalid or oversized q degrades to the empty results page rather than throwing
const searchSettingsSearchSchema = z.object({
  q: z.string().max(SETTINGS_SEARCH_QUERY_MAX_BYTES).optional()
})

export const Route = createFileRoute('/settings/search')({
  component: SearchResultsPage,
  validateSearch: (search: Record<string, unknown>) => {
    const parsed = searchSettingsSearchSchema.safeParse(search)
    return parsed.success ? parsed.data : {}
  }
})
