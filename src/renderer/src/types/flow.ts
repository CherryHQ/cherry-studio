import { MessageBlockStatus } from './newMessage'

export type FlowType = 'workflow' | 'chatflow'

/**
 * 定义 Workflow 类型的工作流配置
 */
interface FlowBase {
  id: string // 工作流唯一标识
  providerId: string // 所属 Provider 的 ID
  name: string // 工作流名称
  description?: string // 工作流描述
  enabled: boolean // 是否启用
  apiKey: string
  apiHost: string
  parameters?: IUserInputForm[]
  inputs?: Record<string, string> // 保存工作流输入参数
}

/**
 * 用户输入表单控件类型
 */
export type IUserInputFormItemType = 'text-input' | 'paragraph' | 'select' | 'number' | 'file' | 'file-list'

/**
 * 支持的文件类型
 */
export type IFileType = 'document' | 'image' | 'audio' | 'video' | 'custom'

/**
 * 用户输入表单控件对象
 */
export interface IUserInputFormItemValueBase {
  default: string
  label: string
  required: boolean
  variable: string
  options?: string[]
  /**
   * 最大长度
   */
  max_length?: number
  type: IUserInputFormItemType
  allowed_file_types?: IFileType[]
}

/**
 * 应用输入配置
 */
export type IUserInputForm = Record<IUserInputFormItemType, IUserInputFormItemValueBase>

export interface Workflow extends FlowBase {
  type: 'workflow'
  trigger: string
}

/**
 * 定义 Chatflow 类型的工作流配置
 */
export interface Chatflow extends FlowBase {
  type: 'chatflow'
  trigger: string
}

/**
 * 定义单个工作流配置 (联合类型)
 */
export type Flow = Workflow | Chatflow

/**
 * 定义工作流提供者
 */
export interface FlowEngine {
  id: string // Provider 唯一标识
  name: string // Provider 名称
  flows: Flow[] // 该 Provider 下的所有工作流 (使用联合类型)
  isSystem?: boolean // 是否为系统内置 Provider
}

export enum EventEnum {
  /**
   * 消息事件，代表普通消息的发送或接收
   */
  MESSAGE = 'message',
  /**
   * 代理消息事件，代表代理发送的消息
   */
  AGENT_MESSAGE = 'agent_message',
  /**
   * 代理思考事件，代表代理在处理过程中的思考信息
   */
  AGENT_THOUGHT = 'agent_thought',
  /**
   * 消息文件事件，代表与消息相关的文件信息
   */
  MESSAGE_FILE = 'message_file',
  /**
   * 消息结束事件，代表一条消息的处理结束
   */
  MESSAGE_END = 'message_end',
  /**
   * TTS 消息事件，代表文本转语音的消息
   */
  TTS_MESSAGE = 'tts_message',
  /**
   * TTS 消息结束事件，代表文本转语音消息的处理结束
   */
  TTS_MESSAGE_END = 'tts_message_end',
  /**
   * 消息替换事件，代表对已有消息的替换操作
   */
  MESSAGE_REPLACE = 'message_replace',
  /**
   * 错误事件，代表系统出现错误的情况
   */
  ERROR = 'error',
  /**
   * 心跳事件，用于保持连接或检测服务状态
   */
  PING = 'ping',
  /**
   * 工作流开始事件，代表工作流开始执行
   */
  WORKFLOW_STARTED = 'workflow_started',
  /**
   * 工作流结束事件，代表工作流执行完成
   */
  WORKFLOW_FINISHED = 'workflow_finished',
  /**
   * 工作流节点开始事件，代表工作流中的某个节点开始执行
   */
  WORKFLOW_NODE_STARTED = 'node_started',
  /**
   * 工作流节点结束事件，代表工作流中的某个节点执行完成
   */
  WORKFLOW_NODE_FINISHED = 'node_finished',
  /**
   * 工作流文本事件，代表工作流中的文本信息
   */
  WORKFLOW_TEXT_CHUNK = 'text_chunk'
}

export interface FlowNode {
  status: MessageBlockStatus
  id: string
  title: string
  type: string
}
