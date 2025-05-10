import { createDifyApiInstance, IFile, IUploadFileResponse, IUserInputForm } from '@dify-chat/api'
import { getFileTypeByName } from '@renderer/components/Dify/FileUpload'
import { EventEnum, Flow, FlowEngine } from '@renderer/types'
import { Chunk, ChunkType } from '@renderer/types/chunk'
import { FileMessageBlock, ImageMessageBlock, Message } from '@renderer/types/newMessage'
import { findFileBlocks, findImageBlocks, getMainTextContent } from '@renderer/utils/messageUtils/find'
import XStream from '@renderer/utils/stream'
import { v4 as uuidv4 } from 'uuid'

import BaseFlowEngineProvider from './BaseFlowEngineProvider'

export default class DifyFlowEngineProvider extends BaseFlowEngineProvider {
  constructor(provider: FlowEngine) {
    super(provider)
  }

  private async getFiles(flow: Flow, message: Message): Promise<IFile[]> {
    const fileBlocks = findFileBlocks(message)
    const imageBlocks = findImageBlocks(message)

    const files: IFile[] = []
    if (fileBlocks.length === 0 && imageBlocks.length === 0) {
      return []
    }
    const processBlock = async (block: ImageMessageBlock | FileMessageBlock) => {
      if (!block.file) return
      const fileData = await window.api.file.readAsFile(block.file.path, block.file.origin_name)
      const file = new File([fileData.buffer], fileData.name, { type: fileData.type })
      const response = await this.uploadFile(flow, file)
      // const response = {
      //   id: '3f8c7d51-7866-4e7b-a283-f3b4e841db6c',
      //   name: 'image-1746779433348-0.png',
      //   size: 72459,
      //   extension: 'png',
      //   mime_type: 'image/png',
      //   created_by: '3d574994-6349-4df0-aab8-1fdf17eba25c',
      //   created_at: 1746779492,
      //   preview_url: null
      // }

      files.push({
        type: getFileTypeByName(response.name),
        transfer_method: 'local_file',
        upload_file_id: response.id
      })
    }

    for (const fileBlock of fileBlocks) {
      await processBlock(fileBlock)
    }

    for (const imageBlock of imageBlocks) {
      await processBlock(imageBlock)
    }
    return files
  }

  public async chatflowCompletion(flow: Flow, message: Message, onChunk: (chunk: Chunk) => void): Promise<void> {
    const query = getMainTextContent(message)
    const files = await this.getFiles(flow, message)

    try {
      const difyApi = createDifyApiInstance({
        user: uuidv4(),
        apiKey: flow.apiKey,
        apiBase: flow.apiHost
      })

      const response = await difyApi.sendMessage({
        inputs: {},
        files: files,
        user: uuidv4(),
        response_mode: 'streaming',
        query: query
      })
      await this.processStream(response, onChunk)
    } catch (error) {
      console.error('DifyFlowEngineProvider completion error', error)
    }
  }

  public async check(flow: Flow): Promise<{ valid: boolean; error: Error | null }> {
    try {
      const difyApi = createDifyApiInstance({
        user: uuidv4(),
        apiKey: flow.apiKey,
        apiBase: flow.apiHost
      })

      const response = await difyApi.getAppInfo()

      return { valid: response.name !== undefined, error: null }
    } catch (error) {
      console.error('检查工作流失败', error)
      return { valid: false, error: new Error('检查工作流失败') }
    }
  }

  public async getAppParameters(flow: Flow): Promise<IUserInputForm[]> {
    try {
      const difyApi = createDifyApiInstance({
        user: uuidv4(),
        apiKey: flow.apiKey,
        apiBase: flow.apiHost
      })

      const parameters = await difyApi.getAppParameters()

      return parameters.user_input_form
    } catch (error) {
      console.error('获取工作流参数失败', error)
      throw new Error('获取工作流参数失败')
    }
  }

  public async uploadFile(flow: Flow, file: File): Promise<IUploadFileResponse> {
    try {
      const difyApi = createDifyApiInstance({
        user: uuidv4(),
        apiKey: flow.apiKey,
        apiBase: flow.apiHost
      })

      const response = await difyApi.uploadFile(file)

      return response
    } catch (error) {
      console.error('上传文件失败', error)
      throw new Error('上传文件失败')
    }
  }

  public async workflowCompletion(
    flow: Flow,
    inputs: Record<string, string>,
    onChunk: (chunk: Chunk) => void
  ): Promise<void> {
    try {
      const difyApi = createDifyApiInstance({
        user: uuidv4(),
        apiKey: flow.apiKey,
        apiBase: flow.apiHost
      })

      const body = {
        response_mode: 'streaming',
        user: uuidv4(),
        inputs: inputs
      }

      const response = await difyApi.baseRequest.baseRequest('/workflows/run', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          'Content-Type': 'application/json'
        }
      })

      await this.processStream(response, onChunk)

      return
    } catch (error) {
      console.error('运行工作流失败', error)
      throw new Error('运行工作流失败')
    }
  }

  private async processStream(response: Response, onChunk: (chunk: Chunk) => void): Promise<void> {
    const readableStream = XStream({
      readableStream: response.body as NonNullable<ReadableStream>
    })
    const reader = readableStream.getReader()
    let text = ''
    while (reader) {
      const { value: chunk, done } = await reader.read()
      if (done) {
        console.log('流已结束')
        onChunk({ type: ChunkType.WORKFLOW_FINISHED })
        break
      }
      if (!chunk) {
        console.log('chunk 为空')
        continue
      }
      if (chunk.data) {
        try {
          const parsedData = JSON.parse(chunk.data)
          const event = parsedData.event
          switch (event) {
            case EventEnum.WORKFLOW_STARTED:
              // onChunk({
              //   type: ChunkType.WORKFLOW_STARTED,
              //   metadata: { id: parsedData.data.id, title: parsedData.data.title, type: parsedData.data.node_type }
              // })
              console.log('工作流开始')
              break
            case EventEnum.WORKFLOW_NODE_STARTED:
              onChunk({
                type: ChunkType.WORKFLOW_NODE_STARTED,
                metadata: { id: parsedData.data.id, title: parsedData.data.title, type: parsedData.data.node_type }
              })
              console.log('工作流节点开始')
              break
            case EventEnum.WORKFLOW_TEXT_CHUNK: {
              const textChunk = parsedData.data.text
              text += textChunk
              onChunk({ type: ChunkType.TEXT_DELTA, text: textChunk })
              break
            }
            case EventEnum.MESSAGE: {
              const textChunk = parsedData.answer
              text += textChunk
              onChunk({ type: ChunkType.TEXT_DELTA, text: textChunk })
              break
            }
            case EventEnum.WORKFLOW_NODE_FINISHED:
              onChunk({
                type: ChunkType.WORKFLOW_NODE_FINISHED,
                metadata: { id: parsedData.data.id, title: parsedData.data.title, type: parsedData.data.node_type }
              })
              console.log('工作流节点完成')
              break
            case EventEnum.WORKFLOW_FINISHED:
              // onChunk({
              //   type: ChunkType.WORKFLOW_FINISHED,
              //   metadata: { id: parsedData.data.id, title: parsedData.data.title, type: parsedData.data.node_type }
              // })
              console.log('工作流完成')
              break
          }
        } catch (e) {
          console.error('处理流数据失败', e)
        }
      } else {
        console.log('chunk 没有 data 属性')
        continue
      }
    }
    onChunk({ type: ChunkType.TEXT_COMPLETE, text: text })
  }
}
