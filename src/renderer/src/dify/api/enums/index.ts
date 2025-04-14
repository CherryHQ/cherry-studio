/**
 * 对话接口流式输出事件类型列表
 */
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
  WORKFLOW_NODE_FINISHED = 'node_finished'
}
