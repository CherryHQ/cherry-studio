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
  /** 点击或操作回调标识，前端可根据此字段触发路由或函数 */
  actionKey?: string
  /** 声音/声音开关标识，结合用户偏好决定是否播放 */
  silent?: boolean
  /** 渠道：系统级（OS 通知）｜应用内（UI 通知） */
  channel?: 'system' | 'in-app'
  /** 点击回调函数，仅在 type 为 'action' 时有效 */
  onClick?: () => void
  /** 通知源 */
  source: NotificationSource
}
