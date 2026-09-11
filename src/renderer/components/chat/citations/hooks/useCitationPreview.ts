import React from 'react'
import { useSWRConfig } from 'swr'
import useSWRImmutable from 'swr/immutable'
import { v4 as uuid } from 'uuid'

import { ipcApi } from '@renderer/ipc'

export interface CitationPreviewSession {
  load(url: string): Promise<void>
}

const citationPreviewKey = (url: string) => ['citationPreview', url] as const

export const useCitationPreviewSession = (): CitationPreviewSession => {
  const { mutate } = useSWRConfig()
  const [requestId] = React.useState<string>(() => uuid())
  const requestsRef = React.useRef(new Map<string, Promise<void>>())

  const load = React.useCallback(
    (url: string): Promise<void> => {
      const existing = requestsRef.current.get(url)
      if (existing) return existing

      const request = ipcApi
        .request('citation.fetch_preview', { url, requestId })
        .then(async ({ content }) => {
          if (content) {
            await mutate(citationPreviewKey(url), content, { revalidate: false })
          }
        })
        .catch(() => undefined)

      requestsRef.current.set(url, request)
      return request
    },
    [mutate, requestId]
  )

  React.useEffect(() => {
    const requests = requestsRef.current

    return () => {
      const hasRequests = requests.size > 0
      requests.clear()

      if (hasRequests) {
        void ipcApi.request('citation.cancel_previews', { requestId }).catch(() => undefined)
      }
    }
  }, [requestId])

  return React.useMemo(() => ({ load }), [load])
}

export const useCitationPreview = (url: string | undefined, session: CitationPreviewSession) => {
  const { data } = useSWRImmutable<string>(url ? citationPreviewKey(url) : null, null)
  const [settledUrl, setSettledUrl] = React.useState<string>()

  React.useEffect(() => {
    if (!url || data !== undefined) return

    let active = true
    void session.load(url).finally(() => {
      if (active) setSettledUrl(url)
    })

    return () => {
      active = false
    }
  }, [data, session, url])

  return {
    content: data,
    isLoading: Boolean(url) && data === undefined && settledUrl !== url
  }
}
