import { useEffect, useState } from 'react'

import { loggerService } from '@logger'

const logger = loggerService.withContext('useRemoteAttachmentSelections')

/** Latest presence snapshot for one conversation; a late read for a previous `key` is never shown. */
export function useRemoteAttachmentSelections<T>(
  key: string,
  load: () => Promise<T[]>,
  subscribe: (onChange: () => void) => () => void
): T[] {
  const [snapshot, setSnapshot] = useState<{ key: string; items: T[] }>()
  useEffect(() => {
    let retired = false
    let reading = false
    let dirty = false
    const refresh = async () => {
      dirty = true
      if (reading) return
      reading = true
      try {
        while (dirty && !retired) {
          dirty = false
          const items = await load()
          if (!retired) setSnapshot({ key, items })
        }
      } catch (error) {
        logger.warn('Attachment selection refresh failed', error as Error)
      } finally {
        reading = false
      }
    }
    const unsubscribe = subscribe(() => void refresh())
    void refresh()
    return () => {
      retired = true
      unsubscribe()
    }
  }, [key, load, subscribe])
  return snapshot?.key === key ? snapshot.items : []
}
