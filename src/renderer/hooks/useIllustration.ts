import { useEffect, useState } from 'react'

import { ipcApi, useIpcOn } from '@renderer/ipc'
import type { IllustrationData, IllustrationTarget } from '@shared/data/types/illustration'

export function useIllustration(target: IllustrationTarget, initial: IllustrationData): IllustrationData {
  const [observed, setObserved] = useState(initial)
  const accept = (data: IllustrationData | null) => {
    // A delayed snapshot can arrive after a newer push event; retain the newest revision.
    if (data)
      setObserved((previous) => (previous.id !== data.id || previous.revision < data.revision ? data : previous))
  }
  useIpcOn('ai.illustration.changed', (event) => {
    if (event.topicId === target.topicId && event.messageId === target.messageId && event.id === target.id)
      accept(event.data)
  })
  const { topicId, messageId, id } = target
  useEffect(() => {
    let disposed = false
    void ipcApi
      .request('ai.illustration.get', { topicId, messageId, id })
      .then((data) => {
        if (!disposed) accept(data)
      })
      .catch(() => {})
    return () => {
      disposed = true
    }
  }, [topicId, messageId, id])
  return observed.id === initial.id && observed.revision > initial.revision ? observed : initial
}
