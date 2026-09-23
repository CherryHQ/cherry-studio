export type FilesRouteSearch = {
  entryId?: string
}

export function parseFilesRouteSearch(search: Record<string, unknown>): FilesRouteSearch {
  return { entryId: typeof search.entryId === 'string' && search.entryId.length > 0 ? search.entryId : undefined }
}
