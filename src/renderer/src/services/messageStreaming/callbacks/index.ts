import type { Assistant } from '@renderer/types'

import { BlockManager } from '../BlockManager'
import { createBaseCallbacks } from './baseCallbacks'
import { createCitationCallbacks } from './citationCallbacks'
import { createImageCallbacks } from './imageCallbacks'
import { createTextCallbacks } from './textCallbacks'
import { createThinkingCallbacks } from './thinkingCallbacks'
import { createToolCallbacks } from './toolCallbacks'
import { createVideoCallbacks } from './videoCallbacks'

interface CallbacksDependencies {
  blockManager: BlockManager
  dispatch: any
  getState: any
  topicId: string
  assistantMsgId: string
  saveUpdatesToDB: any
  assistant: Assistant
}

export const createCallbacks = (deps: CallbacksDependencies) => {
  const { blockManager, dispatch, getState, topicId, assistantMsgId, saveUpdatesToDB, assistant } = deps

  // 创建基础回调
  const baseCallbacks = createBaseCallbacks({
    blockManager,
    dispatch,
    getState,
    topicId,
    assistantMsgId,
    saveUpdatesToDB,
    assistant
  })

  // 创建各类回调
  const thinkingCallbacks = createThinkingCallbacks({
    blockManager,
    assistantMsgId
  })

  const toolCallbacks = createToolCallbacks({
    blockManager,
    assistantMsgId
  })

  const imageCallbacks = createImageCallbacks({
    blockManager,
    assistantMsgId
  })

  const citationCallbacks = createCitationCallbacks({
    blockManager,
    assistantMsgId,
    getState
  })

  // 创建textCallbacks时传入citationCallbacks的getCitationBlockId方法
  const textCallbacks = createTextCallbacks({
    blockManager,
    getState,
    assistantMsgId,
    getCitationBlockId: citationCallbacks.getCitationBlockId
  })

  const videoCallbacks = createVideoCallbacks({ blockManager, assistantMsgId })

  // 组合所有回调
  return {
    ...baseCallbacks,
    ...textCallbacks,
    ...thinkingCallbacks,
    ...toolCallbacks,
    ...imageCallbacks,
    ...citationCallbacks,
    ...videoCallbacks,
    // 清理资源的方法
    cleanup: () => {
      // 清理由 messageThunk 中的节流函数管理，这里不需要特别处理
      // 如果需要，可以调用 blockManager 的相关清理方法
    }
  }
}
