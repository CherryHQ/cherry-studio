import type { Topic } from '@renderer/types'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'

export type ChatResourceKind = 'topic' | 'session'

export type ChatResourceStatus = 'idle' | 'active' | 'streaming' | 'loading' | 'error' | 'disabled'

export interface ChatResourceItem<Meta extends Record<string, unknown> = Record<string, unknown>> {
  id: string
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

export const ResourceListAdapter = {
  fromTopic: adaptTopicResource,
  fromSession: adaptSessionResource
}
