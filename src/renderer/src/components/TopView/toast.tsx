import type { RequireSome } from '@renderer/types'
import { message as antdMessage } from 'antd'
import type { MessageInstance } from 'antd/es/message/interface'
import type React from 'react'

// Global message instance for static usage
let messageApi: MessageInstance | null = null

// Initialize message API - should be called once the App component is mounted
export const initMessageApi = (api: MessageInstance) => {
  messageApi = api
}

// Get message API instance
const getMessageApi = (): MessageInstance => {
  if (!messageApi) {
    // Fallback to static method if hook API is not available
    return antdMessage
  }
  return messageApi
}

type ToastColor = 'danger' | 'success' | 'warning' | 'default'
type MessageType = 'error' | 'success' | 'warning' | 'info'

interface ToastConfig {
  title?: React.ReactNode
  icon?: React.ReactNode
  description?: React.ReactNode
  timeout?: number
  key?: string | number
  className?: string
  style?: React.CSSProperties
  onClick?: () => void
  onClose?: () => void
}

interface LoadingToastConfig extends ToastConfig {
  promise: Promise<any>
}

const colorToType = (color: ToastColor): MessageType => {
  switch (color) {
    case 'danger':
      return 'error'
    case 'success':
      return 'success'
    case 'warning':
      return 'warning'
    case 'default':
      return 'info'
  }
}

// Toast content component
const ToastContent: React.FC<{ title?: React.ReactNode; description?: React.ReactNode; icon?: React.ReactNode }> = ({
  title,
  description,
  icon
}) => {
  return (
    <div className="flex flex-col gap-1">
      {(icon || title) && (
        <div className="flex items-center gap-2 font-semibold">
          {icon}
          {title}
        </div>
      )}
      {description && <div className="text-sm">{description}</div>}
    </div>
  )
}

const createToast = (color: ToastColor) => {
  return (arg: ToastConfig | string): string | null => {
    const api = getMessageApi()
    const type = colorToType(color) as 'error' | 'success' | 'warning' | 'info'

    if (typeof arg === 'string') {
      // antd message methods return a function to close the message
      api[type](arg)
      return null
    }

    const { title, description, icon, timeout, ...restConfig } = arg

    // Convert timeout from milliseconds to seconds (antd uses seconds)
    const duration = timeout !== undefined ? timeout / 1000 : 3

    return (
      (api.open({
        type: type as 'error' | 'success' | 'warning' | 'info',
        content: <ToastContent title={title} description={description} icon={icon} />,
        duration,
        ...restConfig
      }) as any) || null
    )
  }
}

/**
 * Display an error toast notification with red color
 * @param arg - Toast content (string) or toast options object
 * @returns Toast ID or null
 */
export const error = createToast('danger')

/**
 * Display a success toast notification with green color
 * @param arg - Toast content (string) or toast options object
 * @returns Toast ID or null
 */
export const success = createToast('success')

/**
 * Display a warning toast notification with yellow color
 * @param arg - Toast content (string) or toast options object
 * @returns Toast ID or null
 */
export const warning = createToast('warning')

/**
 * Display an info toast notification with default color
 * @param arg - Toast content (string) or toast options object
 * @returns Toast ID or null
 */
export const info = createToast('default')

/**
 * Display a loading toast notification that resolves with a promise
 * @param args - Toast options object containing a promise to resolve
 */
export const loading = (args: RequireSome<LoadingToastConfig, 'promise'>): string | null => {
  const api = getMessageApi()
  const { title, description, icon, promise, timeout, ...restConfig } = args

  // Generate unique key for this loading message
  const key = args.key || `loading-${Date.now()}-${Math.random()}`

  // Show loading message
  api.loading({
    content: <ToastContent title={title || 'Loading...'} description={description} icon={icon} />,
    duration: 0, // Don't auto-close
    key,
    ...restConfig
  })

  // Handle promise resolution
  promise
    .then((result) => {
      api.success({
        content: <ToastContent title={title || 'Success'} description={description} />,
        duration: timeout !== undefined ? timeout / 1000 : 2,
        key,
        ...restConfig
      })
      return result
    })
    .catch((err) => {
      api.error({
        content: (
          <ToastContent title={title || 'Error'} description={err?.message || description || 'An error occurred'} />
        ),
        duration: timeout !== undefined ? timeout / 1000 : 3,
        key,
        ...restConfig
      })
      throw err
    })

  return key as string
}

/**
 * Add a toast notification
 * @param config - Toast configuration object
 * @returns Toast ID or null
 */
export const addToast = (config: ToastConfig) => info(config)

/**
 * Close a specific toast notification by its key
 * @param key - Toast key (string)
 */
export const closeToast = (key: string) => {
  getMessageApi().destroy(key)
}

/**
 * Close all toast notifications
 */
export const closeAll = () => {
  getMessageApi().destroy()
}

/**
 * Stub functions for compatibility with previous toast API
 * These are no-ops since antd message doesn't expose a queue
 */

/**
 * @deprecated This function is a no-op stub for backward compatibility only.
 * Antd message doesn't expose a queue. Do not rely on this function.
 * @returns Empty toast queue stub
 */
export const getToastQueue = (): any => ({ toasts: [] })

/**
 * @deprecated This function is a no-op stub for backward compatibility only.
 * Antd message doesn't track closing state. Do not rely on this function.
 * @param key - Toast key (unused)
 * @returns Always returns false
 */
export const isToastClosing = (key?: string): boolean => {
  key // unused
  return false
}

export const getToastUtilities = () =>
  ({
    getToastQueue,
    addToast,
    closeToast,
    closeAll,
    isToastClosing,
    error,
    success,
    warning,
    info,
    loading
  }) as const
