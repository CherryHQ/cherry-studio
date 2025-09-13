import assistantTodoService from '@renderer/services/AssistantTodoService'
import { useAppSelector } from '@renderer/store'
import { selectActiveTodoExecutorSet } from '@renderer/store/runtime'
import { PropsWithChildren, useEffect } from 'react'

export default function TodoProvider({ children }: PropsWithChildren<{}>) {
  const { assistants } = useAppSelector((state) => state.assistants)
  const activeExecutors = useAppSelector((state) => selectActiveTodoExecutorSet(state))

  // Drive queue on todos changes for active assistants only
  useEffect(() => {
    try {
      assistants.forEach((assistant) => {
        if (!activeExecutors.has(assistant.id)) return
        const byTopic = assistant.todos || {}
        Object.keys(byTopic).forEach((topicId) => {
          const list = byTopic[topicId] || []
          const hasPending = list.some((t) => t.status === 'pending')
          if (hasPending) {
            assistantTodoService.processNext(assistant.id, topicId)
          }
        })
      })
    } catch (e) {
      // swallow errors to avoid breaking render tree
      // use global logger if needed
    }
  }, [assistants, activeExecutors])
  return children
}
