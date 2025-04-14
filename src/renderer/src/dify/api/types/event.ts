import { EventEnum } from '../enums'
import { IFileType } from './file'

/**
 * 模型使用的Token信息及费用相关数据
 */
export type IUsage = {
  // 提示词使用的 token 数量
  prompt_tokens: number
  // 提示词每个 token 的单价
  prompt_unit_price: string
  // 提示词费用的货币单位
  prompt_price_unit: string
  // 提示词的总费用
  prompt_price: string
  // 完成结果使用的 token 数量
  completion_tokens: number
  // 完成结果每个 token 的单价
  completion_unit_price: string
  // 完成结果费用的货币单位
  completion_price_unit: string
  // 完成结果的总费用
  completion_price: string
  // 总共使用的 token 数量
  total_tokens: number
  // 总费用
  total_price: string
  // 费用的货币类型
  currency: string
  // 响应延迟时间
  latency: number
}

/**
 * 知识库引用对象
 */
export interface IRetrieverResource {
  /**
   * 知识库引用对象的唯一标识符
   */
  id: string
  /**
   * 关联的消息的唯一标识符
   */
  message_id: string
  /**
   * 知识库引用在消息中的位置
   */
  position: number
  /**
   * 数据集的唯一标识符
   */
  dataset_id: string
  /**
   * 数据集的名称
   */
  dataset_name: string
  /**
   * 文档的唯一标识符
   */
  document_id: string
  /**
   * 文档的名称
   */
  document_name: string
  /**
   * 数据源的类型
   */
  data_source_type: string
  /**
   * 文档片段的唯一标识符
   */
  segment_id: string
  /**
   * 匹配得分
   */
  score: number
  /**
   * 命中次数
   */
  hit_count: number
  /**
   * 文档片段的字数
   */
  word_count: number
  /**
   * 文档片段在文档中的位置
   */
  segment_position: number
  /**
   * 索引节点的哈希值，当前为 null
   */
  index_node_hash: null
  /**
   * 文档片段的内容
   */
  content: string
  /**
   * 知识库引用对象创建的时间戳
   */
  created_at: number
}

/**
 * 消息事件
 */
export type IMessageEvent = {
  // 事件类型，固定为消息事件
  event: EventEnum.MESSAGE
  // 任务的 ID
  task_id: string
  // 消息的 ID
  message_id: string
  // 对话的 ID
  conversation_id: string
  // 消息的内容
  answer: string
  // 消息创建的时间戳
  created_at: number
}

/**
 * Agent 消息事件
 */
export type IAgentMessageEvent = {
  // 事件类型，固定为代理消息事件
  event: EventEnum.AGENT_MESSAGE
  // 任务的 ID
  task_id: string
  // 消息的 ID
  message_id: string
  // 对话的 ID
  conversation_id: string
  // 代理消息的内容
  answer: string
  // 代理消息创建的时间戳
  created_at: number
}

/**
 * Agent 思考事件
 */
export type IAgentThoughtEvent = {
  // 事件类型，固定为代理思考事件
  event: EventEnum.AGENT_THOUGHT
  // 事件的 ID
  id: string
  // 任务的 ID
  task_id: string
  // 消息的 ID
  message_id: string
  // 思考信息在消息中的位置
  position: number
  // 代理的思考内容
  thought: string
  // 代理的观察内容
  observation: string
  // 代理使用的工具名称
  tool: string
  // 代理使用工具的输入
  tool_input: string
  // 事件创建的时间戳
  created_at: number
  // 相关的消息文件 ID 列表
  message_files: string[]
  // 文件的 ID
  file_id: string
  // 对话的 ID
  conversation_id: string
}

/**
 * Agent 思考对象
 */
export type IAgentThought = Omit<IAgentThoughtEvent, 'event'>

/**
 * 文件消息事件
 */
export type IMessageFileEvent = {
  // 事件类型，固定为消息文件事件
  event: EventEnum.MESSAGE_FILE
  // 事件的 ID
  id: string
  // 文件的类型
  type: IFileType
  // 文件所属的对象，用户或助手
  belongs_to: 'user' | 'assistant'
  // 文件的 URL 地址
  url: string
  // 对话的 ID
  conversation_id: string
}

/**
 * 消息结束事件
 */
export type IMessageEndEvent = {
  // 事件类型，固定为消息结束事件
  event: EventEnum.MESSAGE_END
  // 任务的 ID
  task_id: string
  // 消息的 ID
  message_id: string
  // 对话的 ID
  conversation_id: string
  // 消息的元数据
  metadata: Record<string, unknown>
  // 模型使用的 token 信息及费用相关数据
  usage: IUsage
  // 知识库引用列表
  retriever_resources: IRetrieverResource[]
}

/**
 * TTS消息事件
 */
export type ITTSMessageEvent = {
  // 事件类型，固定为 TTS 消息事件
  event: EventEnum.TTS_MESSAGE
  // 任务的 ID
  task_id: string
  // 消息的 ID
  message_id: string
  // 语音消息的音频数据
  audio: string
  // 事件创建的时间戳
  created_at: number
}

/**
 * TTS消息结束事件
 */
export type ITTSMessageEndEvent = {
  // 事件类型，固定为 TTS 消息结束事件
  event: EventEnum.TTS_MESSAGE_END
  // 任务的 ID
  task_id: string
  // 消息的 ID
  message_id: string
  // 空字符串，表示音频结束
  audio: ''
  // 事件创建的时间戳
  created_at: number
}

/**
 * 消息替换事件
 */
export type IMessageReplaceEvent = {
  // 事件类型，固定为消息替换事件
  event: EventEnum.MESSAGE_REPLACE
  // 任务的 ID
  task_id: string
  // 消息的 ID
  message_id: string
  // 对话的 ID
  conversation_id: string
  // 替换后的消息内容
  answer: string
  // 事件创建的时间戳
  created_at: number
}

/**
 * 错误事件
 */
export type IErrorEvent = {
  // 事件类型，固定为错误事件
  event: EventEnum.ERROR
  // 任务的 ID
  task_id: string
  // 消息的 ID
  message_id: string
  // 错误的状态码
  status: number
  // 错误的代码
  code: string
  // 错误的描述信息
  message: string
}

/**
 * 心跳事件
 */
export type IPingEvent = {
  // 事件类型，固定为心跳事件
  event: EventEnum.PING
}

/**
 * 工作流开始事件
 */
export type IWorkflowStartedEvent = {
  // 事件类型，固定为工作流开始事件
  event: EventEnum.WORKFLOW_STARTED
}

/**
 * 工作流完成事件
 */
export type IWorkflowFinishedEvent = {
  // 事件类型，固定为工作流完成事件
  event: EventEnum.WORKFLOW_FINISHED
}

/**
 * 工作流节点开始事件
 */
export type IWorkflowNodeStarted = {
  // 事件类型，固定为工作流节点开始事件
  event: EventEnum.WORKFLOW_NODE_STARTED
}

/**
 * 工作流节点完成事件
 */
export type IWorkflowNodeFinished = {
  // 事件类型，固定为工作流节点完成事件
  event: EventEnum.WORKFLOW_NODE_FINISHED
}

/**
 * 对话接口流式输出响应
 */
export type IChunkChatCompletionResponse =
  | IMessageEvent
  | IAgentMessageEvent
  | IAgentThoughtEvent
  | IMessageFileEvent
  | IMessageEndEvent
  | ITTSMessageEvent
  | ITTSMessageEndEvent
  | IMessageReplaceEvent
  | IErrorEvent
  | IPingEvent
  | IWorkflowStartedEvent
  | IWorkflowFinishedEvent
  | IWorkflowNodeStarted
  | IWorkflowNodeFinished
