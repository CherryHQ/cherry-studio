import type { Topic } from '@renderer/types'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import type { Assistant } from '@shared/data/types/assistant'

export type ChatResourceKind = 'topic' | 'session' | 'assistant'

export type ChatResourceStatus = 'idle' | 'active' | 'streaming' | 'loading' | 'error' | 'disabled'

export interface ChatResourceItem<Meta extends Record<string, unknown> = Record<string, unknown>> {
  id: string
  name: string
  description?: string
  kind: ChatResourceKind
  title: string
  subtitle?: string
  status: ChatResourceStatus
  pinned: boolean
  active: boolean
  disabled: boolean
  meta?: Meta
}

export interface ResourceAdapterOptions<Meta extends Record<string, unknown> = Record<string, unknown>> {
  active?: boolean
  disabled?: boolean
  pinned?: boolean
  status?: ChatResourceStatus
  subtitle?: string
  meta?: Meta
}

export interface SessionResourceAdapterOptions<Meta extends Record<string, unknown> = Record<string, unknown>>
  extends ResourceAdapterOptions<Meta> {
  channel?: string
  streaming?: boolean
}

function normalizeStatus({
  active,
  disabled,
  status,
  streaming
}: Pick<SessionResourceAdapterOptions, 'active' | 'disabled' | 'status' | 'streaming'>): ChatResourceStatus {
  if (disabled) return 'disabled'
  if (streaming) return 'streaming'
  if (status) return status
  if (active) return 'active'
  return 'idle'
}

export function adaptTopicResource(
  topic: Pick<Topic, 'id' | 'name' | 'pinned' | 'prompt'>,
  options: ResourceAdapterOptions = {}
): ChatResourceItem {
  const active = options.active ?? false
  const disabled = options.disabled ?? false

  return {
    id: topic.id,
    name: topic.name,
    description: options.subtitle ?? topic.prompt,
    kind: 'topic',
    title: topic.name,
    subtitle: options.subtitle ?? topic.prompt,
    status: normalizeStatus({ active, disabled, status: options.status }),
    pinned: options.pinned ?? topic.pinned ?? false,
    active,
    disabled,
    ...(options.meta && { meta: options.meta })
  }
}

export function adaptSessionResource(
  session: Pick<AgentSessionEntity, 'id' | 'agentId' | 'name' | 'description' | 'accessiblePaths'>,
  options: SessionResourceAdapterOptions = {}
): ChatResourceItem {
  const active = options.active ?? false
  const disabled = options.disabled ?? false

  return {
    id: session.id,
    name: session.name,
    description: options.subtitle ?? session.description,
    kind: 'session',
    title: session.name,
    subtitle: options.subtitle ?? session.description,
    status: normalizeStatus({ active, disabled, status: options.status, streaming: options.streaming }),
    pinned: options.pinned ?? false,
    active,
    disabled,
    meta: {
      agentId: session.agentId,
      accessiblePathCount: session.accessiblePaths.length,
      ...(options.channel && { channel: options.channel }),
      ...options.meta
    }
  }
}

export function adaptAssistantResource(
  assistant: Pick<Assistant, 'id' | 'name' | 'emoji' | 'description' | 'createdAt' | 'updatedAt'>,
  options: ResourceAdapterOptions = {}
): ChatResourceItem {
  const active = options.active ?? false
  const disabled = options.disabled ?? false

  return {
    id: assistant.id,
    name: assistant.name,
    description: options.subtitle ?? assistant.description,
    kind: 'assistant',
    title: assistant.name,
    subtitle: options.subtitle ?? assistant.description,
    status: normalizeStatus({ active, disabled, status: options.status }),
    pinned: options.pinned ?? false,
    active,
    disabled,
    meta: {
      emoji: assistant.emoji,
      createdAt: assistant.createdAt,
      updatedAt: assistant.updatedAt,
      ...options.meta
    }
  }
}

export const ResourceListAdapter = {
  fromAssistant: adaptAssistantResource,
  fromTopic: adaptTopicResource,
  fromSession: adaptSessionResource
}
