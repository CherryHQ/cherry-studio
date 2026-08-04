export type NotificationType = 'progress' | 'success' | 'error' | 'warning' | 'info' | 'action'
export type NotificationSource = 'assistant' | 'backup' | 'knowledge' | 'update'

export interface Notification<T = any> {
  /** 通知唯一标识 */
  id: string
  /** 通知分类 */
  type: NotificationType
  /** 简要标题，用于列表或弹框的主文案 */
  title: string
  /** 详细描述，可包含执行上下文、结果摘要等 */
  message: string
  /** 时间戳，便于排序与去重 */
  timestamp: number
  /** 可选的进度值（0～1），针对长任务反馈 */
  progress?: number
  /** 附加元数据，T 可定制各种业务字段 */
  meta?: T
  /**
   * 点击/操作的可序列化标识（'action' 类通知用）。回调函数无法跨 Electron IPC 结构化克隆，
   * 因此改由该字段承载：将来接入 action 通知时，renderer 订阅 `notification.clicked` 事件、
   * 按 actionKey 在本地注册表里查回调并触发。
   */
  actionKey?: string
  /** 声音/声音开关标识，结合用户偏好决定是否播放 */
  silent?: boolean
  /** 通知源 */
  source: NotificationSource
}
