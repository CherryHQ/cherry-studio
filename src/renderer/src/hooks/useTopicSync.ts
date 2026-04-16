import { useAppDispatch } from '@renderer/store'
import { updateTopic } from '@renderer/store/assistants'
import { IpcChannel } from '@shared/IpcChannel'
import { useEffect } from 'react'

export function useTopicSync() {
  const dispatch = useAppDispatch()

  useEffect(() => {
    if (!window.electron?.ipcRenderer) return

    const removeListener = window.electron.ipcRenderer.on(IpcChannel.Topic_Updated, (_, topic) => {
      if (!topic?.assistantId) return
      dispatch(updateTopic({ assistantId: topic.assistantId, topic }))
    })

    return () => {
      removeListener()
    }
  }, [dispatch])
}
