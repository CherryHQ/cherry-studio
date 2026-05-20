import { CollaborationApiClient } from '@renderer/api/collaboration'
import { useMemo } from 'react'

import { useSettings } from '../useSettings'

export const useCollaborationClient = () => {
  const { apiServer } = useSettings()
  const { host, port, apiKey } = apiServer

  return useMemo(
    () =>
      new CollaborationApiClient({
        baseURL: `http://${host}:${port}`,
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      }),
    [host, port, apiKey]
  )
}
