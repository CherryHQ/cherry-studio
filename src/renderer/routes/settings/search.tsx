import { createFileRoute } from '@tanstack/react-router'
import * as z from 'zod'

import { isQueryTooLarge } from '@renderer/pages/settings/settingsSearch/searchEngine'
import { SearchResultsPage } from '@renderer/pages/settings/settingsSearch/SearchResultsPage'

// Invalid or oversized q degrades to the empty results page rather than throwing.
// Byte-based like the ranking side: zod .max() counts UTF-16 code units
const searchSettingsSearchSchema = z.object({
  q: z
    .string()
    .refine((q) => !isQueryTooLarge(q))
    .optional()
})

export const Route = createFileRoute('/settings/search')({
  component: SearchResultsPage,
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Query values have not passed string/size validation; the schema owns that boundary and strips unrelated keys.
  validateSearch: (search: Record<string, unknown>) => {
    const parsed = searchSettingsSearchSchema.safeParse(search)

    return parsed.success ? parsed.data : {}
  }
})
