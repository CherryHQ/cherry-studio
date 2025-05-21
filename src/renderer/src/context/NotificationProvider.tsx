import { NotificationQueue } from '@renderer/queue/NotificationQueue'
import { Notification } from '@renderer/types/notification'
import { isFocused } from '@renderer/utils/window'
import { notification } from 'antd'
import React, { createContext, use, useEffect, useMemo } from 'react'

type NotificationContextType = {
  open: typeof notification.open
  destroy: typeof notification.destroy
}

const typeMap: Record<string, 'info' | 'success' | 'warning' | 'error'> = {
  error: 'error',
  success: 'success',
  warning: 'warning',
  info: 'info',
  progress: 'info',
  action: 'info'
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined)

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [api, contextHolder] = notification.useNotification({
    stack: {
      threshold: 3
    },
    showProgress: true
  })

  useEffect(() => {
    const queue = NotificationQueue.getInstance()
    const listener = async (notification: Notification) => {
      // 判断是否需要系统通知
      if (notification.channel === 'system' || !isFocused()) {
        window.api.notification.send(notification)
        return
      }
      return new Promise<void>((resolve) => {
        api.open({
          message: notification.title,
          description:
            notification.message.length > 50 ? notification.message.slice(0, 47) + '...' : notification.message,
          duration: 3,
          placement: 'topRight',
          type: typeMap[notification.type] || 'info',
          key: notification.id,
          onClose: resolve
        })
      })
    }
    queue.subscribe(listener)
    return () => queue.unsubscribe(listener)
  }, [api])

  const value = useMemo(
    () => ({
      open: api.open,
      destroy: api.destroy
    }),
    [api]
  )

  return (
    <NotificationContext value={value}>
      {contextHolder}
      {children}
    </NotificationContext>
  )
}

export const useNotification = () => {
  const ctx = use(NotificationContext)
  if (!ctx) throw new Error('useNotification must be used within a NotificationProvider')
  return ctx
}
