import { createDifyApiInstance, IUploadFileResponse, IUserInputForm } from '@dify-chat/api'
import { EventEnum, Flow, FlowEngine } from '@renderer/types'
import { Chunk, ChunkType } from '@renderer/types/chunk'
import XStream from '@renderer/utils/stream'
import { v4 as uuidv4 } from 'uuid'

import BaseFlowEngineProvider from './BaseFlowEngineProvider'

export default class DifyFlowEngineProvider extends BaseFlowEngineProvider {
  constructor(provider: FlowEngine) {
    super(provider)
  }

  public async completion(flow: Flow): Promise<void> {
    return
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

  public async runWorkflow(flow: Flow, inputs: Record<string, string>, onChunk: (chunk: Chunk) => void): Promise<void> {
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

      // const processStream = async (stream: any, idx: number) => {
      //   const decoder = new TextDecoder()
      //   let fullText = ''

      //   for await (const chunk of stream) {
      //     // 将 Uint8Array 转换为文本
      //     const text = decoder.decode(chunk, { stream: true })

      //     // 尝试解析为 JSON
      //     try {
      //       // 一个 chunk 可能包含多个 JSON 对象，按行分割
      //       const lines = text.split('\n').filter((line) => line.trim())

      //       for (const line of lines) {
      //         // 有些流式响应使用 data: 前缀
      //         const jsonStr = line.startsWith('data: ') ? line.slice(5) : line

      //         if (jsonStr && jsonStr !== '[DONE]') {
      //           console.log('原始文本:', jsonStr)
      //           const jsonData = JSON.parse(jsonStr)
      //           if (jsonData && jsonData.event === 'text_chunk') {
      //             const textChunk = jsonData.data.text
      //             fullText += textChunk
      //           }
      //         }
      //       }
      //     } catch (e) {
      //       console.error('解析 JSON 失败:', e, 'Raw text:', text)
      //     }
      //     console.log('完整文本:', fullText)
      //   }
      // }

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
    console.log('完整文本:', text)
    onChunk({ type: ChunkType.TEXT_COMPLETE, text: text })
  }
}
