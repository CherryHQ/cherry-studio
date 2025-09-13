import { Assistant, FileType, Model, Topic } from '@types'

export interface PendingUserMessage {
  id: string
  content: string
  files?: FileType[]
  mentions?: Model[]
}

export enum TodoStatus {
  Pending = 'pending',
  Processing = 'processing',
  Done = 'done',
  Failed = 'failed'
}

export enum TodoAction {
  SendMessage = 'sendMessage' // send a message
}

export interface BaseTodo {
  id: string
  title: string
  description?: string
  createdAt: string
  updatedAt: string
  action: TodoAction
  status: TodoStatus
  error?: Error
  /** Captured assistant context for the action */
  assistant: Assistant
}

/** An abstraction for pending message */
export interface UserMessageTodo extends BaseTodo {
  action: TodoAction.SendMessage
  context: {
    topic: Topic
    message: PendingUserMessage
  }
}

/**
 * Todo list maintained by an Assistant.
 * Topic id -> Todo[] */
export type AssistantTodos = Record<string, BaseTodo[]>
