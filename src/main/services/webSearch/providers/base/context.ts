export type BaseSearchContext = {
  query: string
  maxResults: number
  signal?: AbortSignal
}

export type UrlSearchContext = BaseSearchContext & {
  searchUrl: string
}

export type RequestSearchContext<TRequestBody> = BaseSearchContext & {
  requestUrl: string
  requestBody: TRequestBody
}

export type ApiKeyRequestSearchContext<TRequestBody> = RequestSearchContext<TRequestBody> & {
  apiKey: string
}
