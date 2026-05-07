import { AlertCircle, AlertTriangle, CheckCircle2, Info, LoaderCircle, X } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { cn } from '../../lib/utils'

export type ToastColor = 'danger' | 'success' | 'warning' | 'default'
export type ToastType = 'error' | 'success' | 'warning' | 'info' | 'loading'

export interface ToastConfig {
  title?: React.ReactNode
  description?: React.ReactNode
  icon?: React.ReactNode
  key?: string | number
  timeout?: number
  onClick?: React.MouseEventHandler<HTMLDivElement>
  onClose?: () => void
  className?: string
  style?: React.CSSProperties
}

export interface LoadingToastConfig extends ToastConfig {
  promise: Promise<any>
}

export interface ToastRecord extends ToastConfig {
  key: string
  type: ToastType
}

export type ToastUtilities = ReturnType<typeof getToastUtilities>

const DEFAULT_TIMEOUT = 3000

let toastQueue: ToastRecord[] = []
const listeners = new Set<() => void>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let mountedViewports = 0
let standaloneViewportRoot: Root | null = null
let standaloneViewportContainer: HTMLDivElement | null = null
let standaloneViewportRequested = false

const notify = () => {
  listeners.forEach((listener) => listener())
}

const ensureStandaloneViewport = () => {
  if (
    typeof document === 'undefined' ||
    mountedViewports > 0 ||
    standaloneViewportRoot ||
    standaloneViewportRequested
  ) {
    return
  }

  standaloneViewportRequested = true

  setTimeout(() => {
    standaloneViewportRequested = false

    if (mountedViewports > 0 || standaloneViewportRoot) {
      return
    }

    standaloneViewportContainer = document.createElement('div')
    standaloneViewportContainer.dataset.cherryToastViewport = 'standalone'
    document.body.appendChild(standaloneViewportContainer)

    standaloneViewportRoot = createRoot(standaloneViewportContainer)
    standaloneViewportRoot.render(<ToastViewport standalone />)
  }, 0)
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getToastSnapshot = () => toastQueue

const getToastKey = (key?: string | number) => String(key ?? `toast-${Date.now()}-${Math.random()}`)

const clearTimer = (key: string) => {
  const timer = timers.get(key)

  if (timer) {
    clearTimeout(timer)
    timers.delete(key)
  }
}

const removeToast = (key: string) => {
  const toast = toastQueue.find((item) => item.key === key)
  clearTimer(key)
  toastQueue = toastQueue.filter((item) => item.key !== key)
  toast?.onClose?.()
  notify()
}

const scheduleToast = (toast: ToastRecord) => {
  clearTimer(toast.key)

  if (toast.timeout === 0 || toast.type === 'loading') {
    return
  }

  const timeout = toast.timeout ?? DEFAULT_TIMEOUT
  timers.set(
    toast.key,
    setTimeout(() => {
      removeToast(toast.key)
    }, timeout)
  )
}

const upsertToast = (toast: ToastRecord) => {
  ensureStandaloneViewport()

  const existingIndex = toastQueue.findIndex((item) => item.key === toast.key)

  if (existingIndex >= 0) {
    toastQueue = toastQueue.map((item, index) => (index === existingIndex ? toast : item))
  } else {
    toastQueue = [...toastQueue, toast]
  }

  scheduleToast(toast)
  notify()
}

const colorToType = (color: ToastColor): ToastType => {
  switch (color) {
    case 'danger':
      return 'error'
    case 'success':
      return 'success'
    case 'warning':
      return 'warning'
    default:
      return 'info'
  }
}

const createToast = (color: ToastColor) => {
  return (arg: ToastConfig | string): string => {
    const type = colorToType(color)
    const config = typeof arg === 'string' ? { title: arg } : arg
    const key = getToastKey(config.key)

    upsertToast({
      ...config,
      key,
      type
    })

    return key
  }
}

export const error = createToast('danger')
export const success = createToast('success')
export const warning = createToast('warning')
export const info = createToast('default')

export const loading = (args: LoadingToastConfig): string => {
  const { title, description, icon, promise, timeout, ...restConfig } = args
  const key = getToastKey(args.key)

  upsertToast({
    ...restConfig,
    description,
    icon,
    key,
    title: title || 'Loading...',
    timeout: 0,
    type: 'loading'
  })

  promise
    .then((result) => {
      upsertToast({
        ...restConfig,
        description,
        key,
        title: title || 'Success',
        timeout: timeout ?? 2000,
        type: 'success'
      })
      return result
    })
    .catch((err) => {
      upsertToast({
        ...restConfig,
        description: err?.message || description || 'An error occurred',
        key,
        title: title || 'Error',
        timeout: timeout ?? DEFAULT_TIMEOUT,
        type: 'error'
      })
    })

  return key
}

export const addToast = (config: ToastConfig) => info(config)

export const closeToast = (key: string) => {
  removeToast(key)
}

export const closeAll = () => {
  toastQueue.forEach((toast) => {
    clearTimer(toast.key)
    toast.onClose?.()
  })
  toastQueue = []
  notify()
}

export const getToastQueue = (): { toasts: ToastRecord[] } => ({ toasts: toastQueue })

export const isToastClosing = (): boolean => false

export const getToastUtilities = () =>
  ({
    addToast,
    closeAll,
    closeToast,
    error,
    getToastQueue,
    info,
    isToastClosing,
    loading,
    success,
    warning
  }) as const

const typeIconMap: Record<ToastType, React.ReactNode> = {
  error: <AlertCircle className="size-4 text-destructive" />,
  success: <CheckCircle2 className="size-4 text-success" />,
  warning: <AlertTriangle className="size-4 text-warning" />,
  info: <Info className="size-4 text-info" />,
  loading: <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
}

const ToastItem = ({ toast }: { toast: ToastRecord }) => {
  const icon = toast.icon ?? typeIconMap[toast.type]

  return (
    <div
      className={cn(
        'pointer-events-auto flex min-w-72 max-w-[min(420px,calc(100vw-2rem))] items-start gap-3',
        'rounded-md border border-border bg-popover px-4 py-3 text-popover-foreground shadow-lg',
        toast.className
      )}
      style={toast.style}
      onClick={toast.onClick}>
      <div className="mt-0.5 flex shrink-0 items-center justify-center">{icon}</div>
      <div className="min-w-0 flex-1">
        {toast.title && <div className="break-words font-medium text-sm leading-5">{toast.title}</div>}
        {toast.description && (
          <div className="mt-0.5 break-words text-muted-foreground text-xs leading-5">{toast.description}</div>
        )}
      </div>
      <button
        type="button"
        aria-label="Close"
        className="-mr-1 flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={(event) => {
          event.stopPropagation()
          removeToast(toast.key)
        }}>
        <X className="size-3.5" />
      </button>
    </div>
  )
}

export const ToastViewport = ({ standalone = false }: { standalone?: boolean }) => {
  const [toasts, setToasts] = useState(getToastSnapshot)

  useEffect(() => {
    mountedViewports += 1

    if (!standalone && standaloneViewportRoot) {
      const root = standaloneViewportRoot
      const container = standaloneViewportContainer
      standaloneViewportRoot = null
      standaloneViewportContainer = null

      setTimeout(() => {
        root.unmount()
        container?.remove()
      }, 0)
    }

    const unsubscribe = subscribe(() => setToasts(getToastSnapshot()))

    return () => {
      mountedViewports = Math.max(0, mountedViewports - 1)
      unsubscribe()
    }
  }, [standalone])

  if (toasts.length === 0) {
    return null
  }

  return (
    <div className="-translate-x-1/2 pointer-events-none fixed top-5 left-1/2 z-[10000] flex flex-col items-center gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.key} toast={toast} />
      ))}
    </div>
  )
}
