import { MessageStatus } from '@ant-design/x/es/use-x-chat'

import { IAgentThought, IRetrieverResource } from './event'

/**
 * 工作流节点数据
 */
export interface IWorkflowNode {
  /**
   * 步骤 ID
   */
  id: string
  /**
   * 步骤标题
   */
  title: string
  /**
   * 运行状态
   */
  status: 'init' | 'running' | 'success' | 'error'
  /**
   * 节点类型 question-classifier/问题分类器
   */
  type: 'question-classifier'
  /**
   * 节点输入 序列化的 JSON 数据
   */
  inputs: string
  /**
   * 处理过程 序列化的 JSON 数据
   */
  process_data: string
  /**
   * 节点输出 序列化的 JSON 数据
   */
  outputs: string
  /**
   * 耗时 单位秒
   */
  elapsed_time: number
  /**
   * 执行元数据
   */
  execution_metadata: {
    /**
     * 总共消耗 tokens
     */
    total_tokens: number
    /**
     * 总共消耗金额
     */
    total_price: number
    /**
     * 货币单位
     */
    currency: string
  }
}

/**
 * 消息对象中的文件 item
 */
export interface IMessageFileItem {
  id: string
  filename: string
  type: string
  url: string
  mime_type: string
  size: number
  transfer_method: string
  belongs_to: string
}

export interface IAgentMessage {
  /**
   * 工作流信息
   */
  workflows?: {
    /**
     * 整个工作流的运行状态 running-运行中，finished-已完成
     */
    status?: 'running' | 'finished'
    /**
     * 工作流的节点详细信息
     */
    nodes?: IWorkflowNode[]
  }
  /**
   * 文件列表
   */
  files?: IMessageFileItem[]
  /**
   * 消息主体内容
   */
  content: string
  /**
   * Agent 思维链信息
   */
  agentThoughts?: IAgentThought[]
  /**
   * 知识库引用列表
   */
  retrieverResources?: IRetrieverResource[]
}

/**
 * 反馈操作类型 like-点赞, dislike-点踩 null-取消
 */
export type IRating = 'like' | 'dislike' | null

/**
 * 用于渲染的消息数据对象
 */
export interface IMessageItem4Render extends IAgentMessage {
  /**
   * 消息 ID
   */
  id: string
  /**
   * 消息状态
   */
  status: MessageStatus
  /**
   * 当 status 为 error 时, 返回的错误信息
   */
  error?: string
  /**
   * 角色
   */
  role: 'local' | 'user' | 'ai'
  /**
   * 是否为历史消息
   */
  isHistory?: boolean
  /**
   * 用户对消息的反馈
   */
  feedback?: {
    /**
     * 操作类型
     */
    rating: IRating
  }
  /**
   * 消息创建时间（YYYY-MM-DD HH:mm:ss）
   */
  created_at: string
}
