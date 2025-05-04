import { IUploadFileResponse, IUserInputForm } from '@dify-chat/api'
import FlowEngineProvider from '@renderer/providers/FlowEngineProvider'
import { AppDispatch, RootState } from '@renderer/store'
import { upsertOneBlock } from '@renderer/store/messageBlock'
import { newMessagesActions } from '@renderer/store/newMessage'
import { handleChangeLoadingOfTopic, saveUpdatesToDB } from '@renderer/store/thunk/messageThunk'
import { Flow, FlowEngine } from '@renderer/types'
import { MessageBlock, MessageBlockType } from '@renderer/types/newMessage'
import { createFlowBlock } from '@renderer/utils/messageUtils/create'

import { createStreamProcessor, StreamProcessorCallbacks } from './StreamProcessingService'

export async function check(provider: FlowEngine, workflow: Flow) {
  const flowEngineProvider = new FlowEngineProvider(provider)
  return await flowEngineProvider.check(workflow)
}

export async function getAppParameters(provider: FlowEngine, workflow: Flow): Promise<IUserInputForm[]> {
  const flowEngineProvider = new FlowEngineProvider(provider)
  return await flowEngineProvider.getAppParameters(workflow)
}

export async function uploadFile(provider: FlowEngine, workflow: Flow, file: File): Promise<IUploadFileResponse> {
  const flowEngineProvider = new FlowEngineProvider(provider)
  return await flowEngineProvider.uploadFile(workflow, file)
}

export const runWorkflow =
  (topicId: string, provider: FlowEngine, workflow: Flow, inputs: Record<string, string>, assistantMsgId) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    console.log(`[runWorkflowThunk] Starting workflow execution for message ${assistantMsgId} in topic ${topicId}`)
    let accumulatedContent = ''

    const handleBlockTransition = (newBlock: MessageBlock, newBlockType: MessageBlockType) => {
      console.log(`[Transition] Adding/Updating new ${newBlockType} block ${newBlock.id}.`)

      dispatch(
        newMessagesActions.updateMessage({
          topicId,
          messageId: assistantMsgId,
          updates: { blockInstruction: { id: newBlock.id } }
        })
      )
      dispatch(upsertOneBlock(newBlock))
      dispatch(
        newMessagesActions.upsertBlockReference({
          messageId: assistantMsgId,
          blockId: newBlock.id,
          status: newBlock.status
        })
      )
      const currentState = getState()
      const updatedMessage = currentState.messages.entities[assistantMsgId]
      if (updatedMessage) {
        saveUpdatesToDB(assistantMsgId, topicId, { blocks: updatedMessage.blocks, status: updatedMessage.status }, [
          newBlock
        ])
      } else {
        console.error(`[handleBlockTransition] Failed to get updated message ${assistantMsgId} from state for DB save.`)
      }
    }

    const callbacks: StreamProcessorCallbacks = {
      onTextChunk: (text) => {
        accumulatedContent += text
        console.log('Accumulated content:', accumulatedContent)
      },
      onTextComplete: () => {
        console.log('Final content:', accumulatedContent)
      },
      onWorkflowChunk: (chunk) => {
        const workflowChunk = createFlowBlock(assistantMsgId, chunk.type, workflow)
        handleBlockTransition(workflowChunk, MessageBlockType.FLOW)
      }
    }

    try {
      const streamProcessorCallbacks = createStreamProcessor(callbacks)
      const flowEngineProvider = new FlowEngineProvider(provider)
      return await flowEngineProvider.runWorkflow(workflow, inputs, streamProcessorCallbacks)
    } catch (error) {
      console.error(`[runWorkflowThunk] Error running workflow:`, error)
      throw error
    } finally {
      console.log(`[runWorkflowThunk] Workflow execution completed for message ${assistantMsgId}`)
      handleChangeLoadingOfTopic(topicId)
    }
  }
