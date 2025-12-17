import type { Notification } from '@renderer/types/notification'
import PQueue from 'p-queue'

type NotificationListener = (notification: Notification) => Promise<void> | void

export class NotificationQueue {
  private static instance: NotificationQueue
  private queue = new PQueue({ concurrency: 1 })
  private listeners: NotificationListener[] = []

  // oxlint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  public static getInstance(): NotificationQueue {
    if (!NotificationQueue.instance) {
      NotificationQueue.instance = new NotificationQueue()
    }
    return NotificationQueue.instance
  }

  public subscribe(listener: NotificationListener) {
    this.listeners.push(listener)
  }

  public unsubscribe(listener: NotificationListener) {
    this.listeners = this.listeners.filter((l) => l !== listener)
  }

  public async add(notification: Notification): Promise<void> {
    await this.queue.add(() => Promise.all(this.listeners.map((listener) => listener(notification))))
  }

  /**
   * 清空通知队列
   */
  public clear(): void {
    this.queue.clear()
  }

  /**
   * 获取队列中等待的任务数量
   */
  public get pending(): number {
    return this.queue.pending
  }

  /**
   * 获取队列的大小（包括正在进行和等待的任务）
   */
  public get size(): number {
    return this.queue.size
  }
}
