import { loggerService } from '@logger'
import { selectNewTopicLoading } from '@renderer/hooks/useMessageOperations'
import { checkRateLimit, sendUserMessage } from '@renderer/services/MessagesService'
import store from '@renderer/store'
import { selectAssistantTodosByTopic, updateAssistantTodo } from '@renderer/store/assistants'
import { selectActiveTodoExecutorSet } from '@renderer/store/runtime'
import { TodoAction, TodoStatus, type UserMessageTodo } from '@renderer/types/todos'

const logger = loggerService.withContext('AssistantTodoService')

/**
 * AssistantTodoService manages the execution of assistant todos
 * It processes pending todos and executes them based on their type
 */
export class AssistantTodoService {
  private static instance: AssistantTodoService
  private inFlight = new Set<string>() // key: `${assistantId}:${topicId}`

  private constructor() {
    return
  }

  /**
   * Get the singleton instance of AssistantTodoService
   */
  public static getInstance(): AssistantTodoService {
    if (!AssistantTodoService.instance) {
      AssistantTodoService.instance = new AssistantTodoService()
    }
    return AssistantTodoService.instance
  }

  /**
   * Get the key for tracking in-flight todos
   */
  private getKey(assistantId: string, topicId: string): string {
    return `${assistantId}:${topicId}`
  }

  /**
   * Process the next pending todo for a specific assistant and topic
   */
  public async processNext(assistantId: string, topicId: string): Promise<void> {
    const key = this.getKey(assistantId, topicId)
    if (this.inFlight.has(key)) return
    this.inFlight.add(key)

    const state = store.getState()
    const active = selectActiveTodoExecutorSet(state)
    if (!active.has(assistantId)) {
      this.inFlight.delete(key)
      return
    }
    // If topic is currently loading, delay and retry later
    const isTopicLoading = selectNewTopicLoading(state, topicId)
    if (isTopicLoading) {
      this.inFlight.delete(key)
      setTimeout(() => this.processNext(assistantId, topicId), 300)
      return
    }
    const list = selectAssistantTodosByTopic(state, assistantId, topicId)
    const next = list.find((t) => t.action === TodoAction.SendMessage && t.status === TodoStatus.Pending) as
      | UserMessageTodo
      | undefined

    if (!next) {
      // No pending todo: release the in-flight flag immediately
      this.inFlight.delete(key)
      return
    }

    try {
      if (checkRateLimit(next.assistant)) {
        // Backoff and retry current topic chain later
        setTimeout(() => this.processNext(assistantId, topicId), 2000)
        return
      }

      // mark processing
      store.dispatch(
        updateAssistantTodo({ assistantId, topicId, todoId: next.id, changes: { status: TodoStatus.Processing } })
      )

      // UserMessageTodo
      if (next.action === TodoAction.SendMessage) {
        await sendUserMessage({
          assistant: next.assistant,
          topic: next.context.topic,
          content: next.context.message.content,
          files: next.context.message.files || [],
          mentions: next.context.message.mentions,
          messageId: next.context.message.id
        })
      }

      // done -> mark as completed (do not remove)
      store.dispatch(
        updateAssistantTodo({ assistantId, topicId, todoId: next.id, changes: { status: TodoStatus.Done } })
      )
    } catch (error) {
      logger.error('Failed to process todo', error as Error)
      // mark failed
      store.dispatch(
        updateAssistantTodo({
          assistantId,
          topicId,
          todoId: next.id || 'unknown',
          changes: { status: TodoStatus.Failed, error: error as Error }
        })
      )
    } finally {
      // Release in-flight and immediately try to process the subsequent pending todo
      this.inFlight.delete(this.getKey(assistantId, topicId))
      // Chain next if any
      try {
        const stateAfter = store.getState()
        const isTopicLoading = selectNewTopicLoading(stateAfter, topicId)
        const assistantAfter = (stateAfter.assistants.assistants || []).find((a) => a.id === assistantId)
        const listAfter = assistantAfter?.todos?.[topicId] || []
        const hasPending = listAfter.some((t) => t.status === TodoStatus.Pending)
        if (hasPending) {
          // Fire-and-forget; guard inFlight prevents overlap
          if (isTopicLoading) {
            setTimeout(() => this.processNext(assistantId, topicId), 300)
          } else {
            this.processNext(assistantId, topicId)
          }
        }
      } catch (_) {
        // swallow
      }
    }
  }
}

// Export singleton instance
export default AssistantTodoService.getInstance()
