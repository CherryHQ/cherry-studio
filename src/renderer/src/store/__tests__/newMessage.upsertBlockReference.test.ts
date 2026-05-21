/**
 * Reducer-level tests for `newMessagesActions.upsertBlockReference`.
 *
 * Covers the T-009 D-005 fix: when a streaming block transitions to SUCCESS
 * the reducer must move `message.status` from PROCESSING → SUCCESS so the
 * BeatLoader placeholder disappears and the action bar (copy / regenerate /
 * quote / ...) appears. Before T-009 this branch was commented out, which is
 * why the bottom 3-dots loading indicator persisted after Ollama replies
 * finished streaming.
 */
import type { Message } from '@renderer/types/newMessage'
import { AssistantMessageStatus, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { describe, expect, it } from 'vitest'

import newMessagesReducer, { newMessagesActions } from '../newMessage'

const INITIAL_STATE = newMessagesReducer(undefined, { type: '@@INIT' })

function seedMessage(message: Partial<Message> & Pick<Message, 'id' | 'topicId' | 'role' | 'status'>) {
  return newMessagesReducer(
    INITIAL_STATE,
    newMessagesActions.addMessage({
      topicId: message.topicId,
      message: {
        assistantId: 'asst-1',
        createdAt: new Date().toISOString(),
        blocks: [],
        ...message
      } as Message
    })
  )
}

const TOPIC = 'topic-1'
const MSG_ID = 'msg-1'
const BLOCK_ID = 'blk-1'

describe('newMessagesActions.upsertBlockReference — message status transitions', () => {
  it('moves message.status from PENDING to PROCESSING on the first STREAMING block', () => {
    const state = seedMessage({
      id: MSG_ID,
      topicId: TOPIC,
      role: 'assistant',
      status: AssistantMessageStatus.PENDING
    })

    const next = newMessagesReducer(
      state,
      newMessagesActions.upsertBlockReference({
        messageId: MSG_ID,
        blockId: BLOCK_ID,
        status: MessageBlockStatus.STREAMING,
        blockType: MessageBlockType.MAIN_TEXT
      })
    )

    expect(next.entities[MSG_ID]?.status).toBe(AssistantMessageStatus.PROCESSING)
    expect(next.entities[MSG_ID]?.blocks).toEqual([BLOCK_ID])
  })

  it('moves message.status from PROCESSING to SUCCESS when the block finishes (T-009 D-005 fix)', () => {
    let state = seedMessage({
      id: MSG_ID,
      topicId: TOPIC,
      role: 'assistant',
      status: AssistantMessageStatus.PENDING
    })
    state = newMessagesReducer(
      state,
      newMessagesActions.upsertBlockReference({
        messageId: MSG_ID,
        blockId: BLOCK_ID,
        status: MessageBlockStatus.STREAMING,
        blockType: MessageBlockType.MAIN_TEXT
      })
    )

    expect(state.entities[MSG_ID]?.status).toBe(AssistantMessageStatus.PROCESSING)

    const next = newMessagesReducer(
      state,
      newMessagesActions.upsertBlockReference({
        messageId: MSG_ID,
        blockId: BLOCK_ID,
        status: MessageBlockStatus.SUCCESS,
        blockType: MessageBlockType.MAIN_TEXT
      })
    )

    expect(next.entities[MSG_ID]?.status).toBe(AssistantMessageStatus.SUCCESS)
  })

  it('does not regress SUCCESS or ERROR back to PROCESSING when a late STREAMING block arrives', () => {
    let state = seedMessage({
      id: MSG_ID,
      topicId: TOPIC,
      role: 'assistant',
      status: AssistantMessageStatus.SUCCESS
    })

    state = newMessagesReducer(
      state,
      newMessagesActions.upsertBlockReference({
        messageId: MSG_ID,
        blockId: 'blk-late',
        status: MessageBlockStatus.STREAMING,
        blockType: MessageBlockType.MAIN_TEXT
      })
    )

    expect(state.entities[MSG_ID]?.status).toBe(AssistantMessageStatus.SUCCESS)
  })

  it('escalates to ERROR even if a SUCCESS block arrives afterwards', () => {
    let state = seedMessage({
      id: MSG_ID,
      topicId: TOPIC,
      role: 'assistant',
      status: AssistantMessageStatus.PENDING
    })

    state = newMessagesReducer(
      state,
      newMessagesActions.upsertBlockReference({
        messageId: MSG_ID,
        blockId: BLOCK_ID,
        status: MessageBlockStatus.ERROR,
        blockType: MessageBlockType.MAIN_TEXT
      })
    )

    expect(state.entities[MSG_ID]?.status).toBe(AssistantMessageStatus.ERROR)

    const next = newMessagesReducer(
      state,
      newMessagesActions.upsertBlockReference({
        messageId: MSG_ID,
        blockId: BLOCK_ID,
        status: MessageBlockStatus.SUCCESS,
        blockType: MessageBlockType.MAIN_TEXT
      })
    )

    // ERROR is terminal — a later SUCCESS must not promote it back to SUCCESS.
    expect(next.entities[MSG_ID]?.status).toBe(AssistantMessageStatus.ERROR)
  })

  it('appends MAIN_TEXT blocks at the tail of message.blocks (unchanged ordering)', () => {
    let state = seedMessage({
      id: MSG_ID,
      topicId: TOPIC,
      role: 'assistant',
      status: AssistantMessageStatus.PENDING,
      blocks: ['existing-1']
    })

    state = newMessagesReducer(
      state,
      newMessagesActions.upsertBlockReference({
        messageId: MSG_ID,
        blockId: 'new-2',
        status: MessageBlockStatus.STREAMING,
        blockType: MessageBlockType.MAIN_TEXT
      })
    )

    expect(state.entities[MSG_ID]?.blocks).toEqual(['existing-1', 'new-2'])
  })

  it('prepends THINKING blocks at the head of message.blocks', () => {
    let state = seedMessage({
      id: MSG_ID,
      topicId: TOPIC,
      role: 'assistant',
      status: AssistantMessageStatus.PENDING,
      blocks: ['existing-1']
    })

    state = newMessagesReducer(
      state,
      newMessagesActions.upsertBlockReference({
        messageId: MSG_ID,
        blockId: 'thought-1',
        status: MessageBlockStatus.STREAMING,
        blockType: MessageBlockType.THINKING
      })
    )

    expect(state.entities[MSG_ID]?.blocks).toEqual(['thought-1', 'existing-1'])
  })
})
