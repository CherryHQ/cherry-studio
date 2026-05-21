import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { BranchAnchor } from '@renderer/pages/home/Messages/BranchPanel'
import { getUserMessage } from '@renderer/services/MessagesService'
import store, { useAppDispatch } from '@renderer/store'
import { selectMessagesForTopic } from '@renderer/store/newMessage'
import { sendMessage as sendMessageThunk } from '@renderer/store/thunk/messageThunk'
import type { Assistant, Topic } from '@renderer/types'
import { buildBranchSystemPrompt } from '@renderer/utils/branchAnchor/buildBranchSystemPrompt'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import type { CreateTopicDto } from '@shared/data/api/schemas/topics'
import type { Topic as SharedTopic } from '@shared/data/types/topic'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useBranchFork')

type ForkStatus = 'idle' | 'creating' | 'error'

interface UseBranchForkArgs {
  /** The assistant currently in use on the source topic. */
  assistant: Assistant
  /** The SOURCE topic — used to read the main-goal (first user message) for the system prompt. */
  topic: Topic
  /**
   * Called with the freshly-created branch topic (renderer shape, with `prompt`
   * pre-injected). The host stores it in side-panel state.
   *
   * Note: this hook deliberately does NOT call `setActiveTopic` or
   * `dispatch(addTopic(...))` — D-2B keeps the main topic active and avoids
   * sidebar pollution. See preflight §W4.
   */
  onCreated: (branchTopic: Topic) => void
  onSuccess?: () => void
}

interface UseBranchForkResult {
  fork: (anchor: BranchAnchor, followUp: string) => Promise<void>
  status: ForkStatus
  errorMessage?: string
  reset: () => void
}

const NAME_MAX_LENGTH = 30
const NAME_FALLBACK = 'Branch'

function buildCreateBody(anchor: BranchAnchor, assistant: Assistant): CreateTopicDto {
  // T-004 sentinel: omit assistantId for the legacy 'default' literal. The
  // branch topic ends up unbound (server stores null) — NOT inherited; the
  // sourceNodeId fork mechanism does no inheritance. sendMessage still runs
  // with the same assistant arg because it's a function parameter.
  const assistantIdField = assistant.id !== 'default' ? { assistantId: assistant.id } : {}
  return {
    name: anchor.selectedText.trim().slice(0, NAME_MAX_LENGTH) || NAME_FALLBACK,
    sourceNodeId: anchor.messageId,
    ...assistantIdField
  }
}

function toRendererBranchTopic(serverTopic: SharedTopic, assistant: Assistant, systemPrompt: string): Topic {
  // Renderer-shape topic with `prompt` injected. `messageThunk.ts:855-857`
  // concatenates `topic.prompt` onto `assistant.prompt` when assembling the
  // system message — this is the prompt-hiding hook (Mode A). The branch
  // topic is NOT dispatched into Redux assistant.topics (would pollute the
  // sidebar); instead, we pass it via `assistant.topics` synthetically when
  // calling sendMessage below.
  return {
    id: serverTopic.id,
    assistantId: serverTopic.assistantId ?? assistant.id,
    name: serverTopic.name,
    createdAt: serverTopic.createdAt,
    updatedAt: serverTopic.updatedAt,
    messages: [],
    prompt: systemPrompt
  }
}

/**
 * Reads the source topic's first user message and returns its main-text
 * content (trimmed). Falls back to `undefined` when none exists. The system
 * prompt builder will then omit the "main goal" section entirely.
 *
 * 200-char truncation is enforced inside `buildBranchSystemPrompt`, not here.
 */
function extractMainGoal(sourceTopicId: string): string | undefined {
  const messages = selectMessagesForTopic(store.getState(), sourceTopicId)
  const firstUser = messages.find((m) => m.role === 'user')
  if (!firstUser) return undefined
  const text = getMainTextContent(firstUser).trim()
  return text.length > 0 ? text : undefined
}

/**
 * useBranchFork — T-006D-2B side-by-side orchestration.
 *
 *   1. POST /topics  → server creates topic with activeNodeId = sourceMessageId
 *   2. Build a renderer-shape topic with `prompt = buildBranchSystemPrompt(...)`
 *      (selectedText + optional main-goal). This is the prompt-hiding slot.
 *   3. Build a *synthetic* assistant whose `topics` array transiently includes
 *      the branch topic, so `fetchAndProcessAssistantResponseImpl:854-857` can
 *      `.find(t => t.id === branchTopicId)` and read `topic.prompt`. **We do
 *      NOT dispatch into Redux assistants.topics** — that would surface the
 *      branch in the sidebar (see preflight §W4).
 *   4. dispatch(sendMessage(cleanFollowUpMessage, blocks, syntheticAssistant,
 *      branchTopic.id)). The user message body is the raw follow-up.
 *   5. Pass the branch topic to `onCreated` so the host can mount the side
 *      panel.
 *
 * Error scope: only POST /topics surfaces failures. sendMessage thunk
 * swallows its own errors (messageThunk.ts:1080-1082); a failed send shows
 * as an ERROR-status message *inside the branch topic's stream*.
 */
export function useBranchFork(args: UseBranchForkArgs): UseBranchForkResult {
  const { assistant, topic, onCreated, onSuccess } = args
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [status, setStatus] = useState<ForkStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined)

  const { trigger: createTopic } = useMutation('POST', '/topics', {
    refresh: ['/topics']
  })

  const reset = useCallback(() => {
    setStatus('idle')
    setErrorMessage(undefined)
  }, [])

  const fork = useCallback(
    async (anchor: BranchAnchor, followUp: string) => {
      setStatus('creating')
      setErrorMessage(undefined)

      let branchTopic: Topic
      try {
        const serverTopic = await createTopic({ body: buildCreateBody(anchor, assistant) })
        const mainGoal = extractMainGoal(topic.id)
        const systemPrompt = buildBranchSystemPrompt({
          selectedText: anchor.selectedText,
          mainGoal
        })
        branchTopic = toRendererBranchTopic(serverTopic, assistant, systemPrompt)
      } catch (error) {
        logger.error('POST /topics failed during branch fork', error as Error)
        setStatus('error')
        setErrorMessage(t('chat.message.anchor.panel.error.create_failed'))
        return
      }

      // Silent-killer guard: if prompt got dropped somewhere between
      // toRendererBranchTopic and here, the model will be context-blind. Fail
      // loud rather than silently.
      if (!branchTopic.prompt || branchTopic.prompt.length === 0) {
        logger.warn('Branch topic created without prompt — model will go blind. Aborting.', {
          branchTopicId: branchTopic.id
        })
        setStatus('error')
        setErrorMessage(t('chat.message.anchor.panel.error.create_failed'))
        return
      }

      // Synthetic assistant. Redux `state.assistants[].topics[]` is untouched
      // (sidebar stays clean). `messageThunk.ts:854` calls
      // `origAssistant.topics.find(t => t.id === topicId)` and reaches the
      // branch topic via this transient array — the same object reference
      // carrying the prompt we just built.
      const assistantWithBranch: Assistant = {
        ...assistant,
        topics: [...assistant.topics, branchTopic]
      }

      logger.debug('branch-fork: dispatching sendMessage with synthetic assistant.topics', {
        branchTopicId: branchTopic.id,
        promptLength: branchTopic.prompt.length,
        syntheticTopicsCount: assistantWithBranch.topics.length,
        // Object-identity assertion: the topic carrying prompt is the same
        // object messageThunk:854 will .find() back.
        sameReference: assistantWithBranch.topics.at(-1) === branchTopic
      })

      const { message, blocks } = getUserMessage({
        assistant: assistantWithBranch,
        topic: branchTopic,
        content: followUp
      })

      void dispatch(sendMessageThunk(message, blocks, assistantWithBranch, branchTopic.id))

      onCreated(branchTopic)
      setStatus('idle')
      onSuccess?.()
    },
    [assistant, topic.id, createTopic, dispatch, onCreated, onSuccess, t]
  )

  return { fork, status, errorMessage, reset }
}
