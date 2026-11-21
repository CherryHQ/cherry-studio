export type FilesRouteSearch = {
  entryId?: string
}

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Raw query values are unvalidated; accept only a nonempty entryId string and ignore unrelated keys.
export function parseFilesRouteSearch(search: Record<string, unknown>): FilesRouteSearch {
  return { entryId: typeof search.entryId === 'string' && search.entryId.length > 0 ? search.entryId : undefined }
}
