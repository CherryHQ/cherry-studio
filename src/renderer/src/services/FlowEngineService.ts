import { IUploadFileResponse, IUserInputForm } from '@dify-chat/api'
import FlowEngineProvider from '@renderer/providers/FlowEngineProvider'
import { AppDispatch, RootState } from '@renderer/store'
import { updateOneBlock, upsertOneBlock } from '@renderer/store/messageBlock'
import { newMessagesActions } from '@renderer/store/newMessage'
import {
  handleChangeLoadingOfTopic,
  saveMessageAndBlocksToDB,
  saveUpdatedBlockToDB,
  saveUpdatesToDB,
  throttledBlockDbUpdate,
  throttledBlockUpdate
} from '@renderer/store/thunk/messageThunk'
import { Assistant, Flow, FlowEngine } from '@renderer/types'
import { ChunkType } from '@renderer/types/chunk'
import { FlowMessageBlock, MessageBlock, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { createAssistantMessage, createFlowBlock, createMainTextBlock } from '@renderer/utils/messageUtils/create'

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
  (topicId: string, provider: FlowEngine, workflow: Flow, inputs: Record<string, string>, assistant: Assistant) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    let accumulatedContent = ''
    let lastBlockId: string | null = null
    let lastBlockType: MessageBlockType | null = null
    let mainTextBlockId: string | null = null
    const workflowNodeIdToBlockIdMap = new Map<string, string>()
    const assistantMessage = createAssistantMessage(assistant.id, topicId)
    await saveMessageAndBlocksToDB(assistantMessage, [])
    dispatch(newMessagesActions.addMessage({ topicId, message: assistantMessage }))
    const handleBlockTransition = (newBlock: MessageBlock, newBlockType: MessageBlockType) => {
      lastBlockId = newBlock.id
      lastBlockType = newBlockType
      if (newBlockType !== MessageBlockType.MAIN_TEXT) {
        accumulatedContent = ''
      }
      console.log(`[Transition] Adding/Updating new ${newBlockType} block ${newBlock.id}.`)
      dispatch(
        newMessagesActions.updateMessage({
          topicId,
          messageId: assistantMessage.id,
          updates: { blockInstruction: { id: newBlock.id } }
        })
      )
      dispatch(upsertOneBlock(newBlock))
      dispatch(
        newMessagesActions.upsertBlockReference({
          messageId: assistantMessage.id,
          blockId: newBlock.id,
          status: newBlock.status
        })
      )

      const currentState = getState()
      const updatedMessage = currentState.messages.entities[assistantMessage.id]
      if (updatedMessage) {
        saveUpdatesToDB(
          assistantMessage.id,
          topicId,
          { blocks: updatedMessage.blocks, status: updatedMessage.status },
          [newBlock]
        )
      } else {
        console.error(
          `[handleBlockTransition] Failed to get updated message ${assistantMessage.id} from state for DB save.`
        )
      }
    }

    const callbacks: StreamProcessorCallbacks = {
      onTextChunk: (text) => {
        accumulatedContent += text
        if (lastBlockId) {
          if (lastBlockType === MessageBlockType.MAIN_TEXT) {
            const blockChanges: Partial<MessageBlock> = {
              content: accumulatedContent,
              status: MessageBlockStatus.STREAMING
            }
            throttledBlockUpdate(lastBlockId, blockChanges)
            throttledBlockDbUpdate(lastBlockId, blockChanges)
          } else {
            const newBlock = createMainTextBlock(assistantMessage.id, accumulatedContent, {
              status: MessageBlockStatus.STREAMING
            })
            handleBlockTransition(newBlock, MessageBlockType.MAIN_TEXT)
            mainTextBlockId = newBlock.id
          }
        }
      },
      onTextComplete: (finalText) => {
        if (lastBlockType === MessageBlockType.MAIN_TEXT && lastBlockId) {
          const changes = {
            content: finalText,
            status: MessageBlockStatus.SUCCESS
          }
          dispatch(updateOneBlock({ id: lastBlockId, changes }))
          saveUpdatedBlockToDB(lastBlockId, assistantMessage.id, topicId, getState)
          console.log(`[onTextComplete] Final text for block ${lastBlockId}:`, finalText)
        } else {
          console.warn(
            `[onTextComplete] Received text.complete but last block was not MAIN_TEXT (was ${lastBlockType}) or lastBlockId is null.`
          )
        }
      },
      onWorkflowNodeInProgress: (chunk) => {
        if (chunk.type === ChunkType.WORKFLOW_NODE_STARTED) {
          const overrides = {
            status: MessageBlockStatus.PROCESSING,
            metadata: {
              id: chunk.metadata.id,
              title: chunk.metadata.title ?? '',
              type: chunk.metadata.type ?? ''
            }
          }

          const flowBlock = createFlowBlock(assistantMessage.id, chunk.type, workflow, overrides)

          handleBlockTransition(flowBlock, MessageBlockType.FLOW)
          workflowNodeIdToBlockIdMap.set(chunk.metadata.id, flowBlock.id)

          console.log(`[onWorkflowChunk] Workflow started block ${flowBlock.id} added.`)
        }
      },
      onWorkflowNodeComplete: (chunk) => {
        if (chunk.type === ChunkType.WORKFLOW_NODE_FINISHED) {
          const existingBlockId = workflowNodeIdToBlockIdMap.get(chunk.metadata.id)
          if (!existingBlockId) {
            console.error(`[onWorkflowChunk] No block found for workflow node ID ${chunk.metadata.id}.`)
            return
          }
          const changes: Partial<FlowMessageBlock> = {
            status: MessageBlockStatus.SUCCESS,
            metadata: { id: chunk.metadata.id, title: chunk.metadata.title ?? '', type: chunk.metadata.type ?? '' }
          }
          dispatch(updateOneBlock({ id: existingBlockId, changes }))
          saveUpdatedBlockToDB(existingBlockId, assistantMessage.id, topicId, getState)
        }
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
      console.log(`[runWorkflowThunk] Workflow execution completed for message ${assistantMessage.id}`)
      handleChangeLoadingOfTopic(topicId)
    }
  }
