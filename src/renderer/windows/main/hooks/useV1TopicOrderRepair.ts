import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { useEffect } from 'react'

const logger = loggerService.withContext('V1TopicOrderRepair')
const PERSIST_KEY = 'persist:cherry-studio'

export interface V1AssistantsTopicRef {
  id: string
  pinned?: boolean
}

export interface V1AssistantsTopicSourcePayload {
  assistants?: Array<{ topics?: V1AssistantsTopicRef[] }>
  defaultAssistant?: { topics?: V1AssistantsTopicRef[] }
}

function topicRefs(topics: unknown): V1AssistantsTopicRef[] {
  if (!Array.isArray(topics)) return []
  const refs: V1AssistantsTopicRef[] = []
  for (const topic of topics) {
    if (!topic || typeof topic !== 'object' || !('id' in topic)) continue
    const id = (topic as { id?: unknown }).id
    if (typeof id !== 'string' || id.length === 0) continue
    const pinned = (topic as { pinned?: unknown }).pinned
    refs.push(typeof pinned === 'boolean' ? { id, pinned } : { id })
  }
  return refs
}

function assistantRefs(assistants: unknown): Array<{ topics?: V1AssistantsTopicRef[] }> {
  if (!Array.isArray(assistants)) return []
  return assistants.map((assistant) => ({
    topics: topicRefs(
      assistant && typeof assistant === 'object' ? (assistant as { topics?: unknown }).topics : undefined
    )
  }))
}

/**
 * `null` = persist is unreadable (retry next boot). `{}` = persist absent
 * (main can mark the one-shot skipped).
 */
export function readV1AssistantsTopicSource(): V1AssistantsTopicSourcePayload | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(PERSIST_KEY)
  } catch (error) {
    logger.warn('Failed to read persist:cherry-studio for topic-order repair', error as Error)
    return null
  }
  if (raw === null) return {}

  try {
    const root = JSON.parse(raw) as unknown
    if (!root || typeof root !== 'object') return null
    const slice = (root as { assistants?: unknown }).assistants
    const parsed = typeof slice === 'string' ? (JSON.parse(slice) as unknown) : slice
    if (!parsed || typeof parsed !== 'object') return {}
    const record = parsed as { assistants?: unknown; defaultAssistant?: unknown }
    const source: V1AssistantsTopicSourcePayload = {}
    const assistants = assistantRefs(record.assistants)
    if (assistants.length > 0) source.assistants = assistants
    if (record.defaultAssistant && typeof record.defaultAssistant === 'object') {
      source.defaultAssistant = {
        topics: topicRefs((record.defaultAssistant as { topics?: unknown }).topics)
      }
    }
    return source
  } catch (error) {
    logger.warn('Failed to parse persist:cherry-studio assistants slice', error as Error)
    return null
  }
}

export async function requestV1TopicOrderRepair(): Promise<void> {
  const source = readV1AssistantsTopicSource()
  if (source === null) return
  await ipcApi.request('app.migration_v2.repair_topic_order', source)
}

export function useV1TopicOrderRepair(): void {
  useEffect(() => {
    void requestV1TopicOrderRepair().catch((error: unknown) => {
      logger.warn('V1 topic-order repair failed', error as Error)
    })
  }, [])
}
