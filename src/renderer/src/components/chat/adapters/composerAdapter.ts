export type ComposerTargetKind = 'chat' | 'session'

export interface ComposerTarget {
  kind: ComposerTargetKind
  id: string
  assistantId?: string
  agentId?: string
}

export interface ComposerAttachment {
  id: string
  name: string
  type?: string
  size?: number
  url?: string
}

export interface ComposerToolReference {
  id: string
  name: string
  enabled?: boolean
}

export interface ComposerDraft {
  text: string
  attachments?: readonly ComposerAttachment[]
  tools?: readonly ComposerToolReference[]
}

export interface ComposerCapabilities {
  attachments?: boolean
  tools?: boolean
  stop?: boolean
}

export interface ComposerSendContext {
  target: ComposerTarget
  draft: ComposerDraft
}

export interface ComposerAdapter {
  target: ComposerTarget
  draft: ComposerDraft
  streaming: boolean
  disabled: boolean
  capabilities: ComposerCapabilities
  send: (context: ComposerSendContext) => void | Promise<void>
  stop?: (target: ComposerTarget) => void | Promise<void>
}

export interface ComposerAdapterOptions {
  target: ComposerTarget
  draft: ComposerDraft
  streaming?: boolean
  disabled?: boolean
  capabilities?: ComposerCapabilities
  send: (context: ComposerSendContext) => void | Promise<void>
  stop?: (target: ComposerTarget) => void | Promise<void>
}

export function createComposerAdapter(options: ComposerAdapterOptions): ComposerAdapter {
  return {
    target: options.target,
    draft: options.draft,
    streaming: options.streaming ?? false,
    disabled: options.disabled ?? false,
    capabilities: options.capabilities ?? {},
    send: options.send,
    ...(options.stop && { stop: options.stop })
  }
}

export function createChatComposerAdapter(
  options: Omit<ComposerAdapterOptions, 'target'> & {
    assistantId: string
    topicId: string
  }
): ComposerAdapter {
  return createComposerAdapter({
    ...options,
    target: {
      kind: 'chat',
      id: options.topicId,
      assistantId: options.assistantId
    }
  })
}

export function createSessionComposerAdapter(
  options: Omit<ComposerAdapterOptions, 'target'> & {
    agentId?: string
    sessionId: string
  }
): ComposerAdapter {
  return createComposerAdapter({
    ...options,
    target: {
      kind: 'session',
      id: options.sessionId,
      ...(options.agentId && { agentId: options.agentId })
    }
  })
}

export const ComposerAdapter = {
  create: createComposerAdapter,
  createChat: createChatComposerAdapter,
  createSession: createSessionComposerAdapter
}
