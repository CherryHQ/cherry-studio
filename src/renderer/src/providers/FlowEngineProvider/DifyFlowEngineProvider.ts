import { XStream } from '@ant-design/x'
import { createDifyApiInstance, EventEnum, IChunkChatCompletionResponse, IWorkflowNode } from '@renderer/dify/api'
import { Flow, FlowEngine } from '@renderer/types'

import BaseFlowEngineProvider from './BaseFlowEngineProvider'

export default class DifyFlowEngineProvider extends BaseFlowEngineProvider {
  constructor(provider: FlowEngine) {
    super(provider)
  }

  public async completion(flow: Flow): Promise<void> {
    if (!this.isChatflow(flow)) {
      throw new Error('Dify completion only supports Chatflow')
    }
    // TODO: 替换为发布的包
    const client = createDifyApiInstance({ user: '123', apiKey: flow.apiKey, apiBase: flow.apiHost })
    const response = await client.sendMessage({
      inputs: {},
      files: [],
      user: '123',
      response_mode: 'streaming',
      query: 'starberry有几个r?'
    })

    const stream = XStream({
      readableStream: response.body as NonNullable<ReadableStream>
    })

    const reader = stream.getReader()
    let result = ''
    while (reader) {
      const { value: chunk, done } = await reader.read()
      if (done) {
        console.log('Stream finished')
        break
      }
      if (!chunk) continue
      let parsedData = {} as {
        id: string
        task_id: string
        position: number
        tool: string
        tool_input: string
        observation: string
        message_files: string[]

        event: IChunkChatCompletionResponse['event']
        answer: string
        conversation_id: string
        message_id: string

        // 类型
        type: 'image'
        // 图片链接
        url: string

        data: {
          // 工作流节点的数据
          id: string
          node_type: IWorkflowNode['type']
          title: string
          inputs: string
          outputs: string
          process_data: string
          elapsed_time: number
          execution_metadata: IWorkflowNode['execution_metadata']
        }
      }
      try {
        parsedData = JSON.parse(chunk.data)
      } catch (error) {
        console.error('解析 JSON 失败', error)
      }
      result = this.processChunk(result, parsedData)
      console.log('当前结果', result)
    }
    console.log('最终结果', result)
    return
  }

  public async check(flow: Flow): Promise<{ valid: boolean; error: Error | null }> {
    if (this.isChatflow(flow)) {
      await this.completion(flow)
      return { valid: true, error: null }
    }

    try {
      // const checkUrl = this.isChatflow(flow) ? flow.apiHost : flow.url
      const checkUrl = flow.url

      const response = await fetch(checkUrl, {
        method: 'GET',
        headers: this.defaultHeaders(flow)
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        const statusText = response.statusText || 'Unknown Error'
        const errorMessage = errorData?.message || `Request failed with status ${response.status}: ${statusText}`
        return { valid: false, error: new Error(errorMessage) }
      }

      return { valid: true, error: null }
    } catch (error) {
      return { valid: false, error: error as Error }
    }
  }

  private processChunk(result: string, parsedData: any): string {
    if (parsedData.event === EventEnum.WORKFLOW_STARTED) {
      console.log('工作流开始', parsedData)
    } else if (parsedData.event === EventEnum.WORKFLOW_FINISHED) {
      console.log('工作流结束', parsedData)
    } else if (parsedData.event === EventEnum.WORKFLOW_NODE_STARTED) {
      console.log('工作流节点开始', parsedData)
    } else if (parsedData.event === EventEnum.WORKFLOW_NODE_FINISHED) {
      console.log('工作流节点结束', parsedData)
    }
    if (parsedData.event === EventEnum.MESSAGE_FILE) {
      console.log('文件消息', parsedData)
    }
    if (parsedData.event === EventEnum.MESSAGE) {
      const text = parsedData.answer
      result += text
    }
    if (parsedData.event === EventEnum.ERROR) {
      console.error('错误', parsedData)
    }
    if (parsedData.event === EventEnum.AGENT_MESSAGE) {
      console.log('Agent消息', parsedData)
    }
    if (parsedData.event === EventEnum.AGENT_THOUGHT) {
      console.log('Agent思考', parsedData)
    }
    return result
  }
}
