import { AlertCircle, AlertTriangle, CheckCircle2, Info, LoaderCircle, X } from 'lucide-react'
import type React from 'react'
import { createContext, use, useMemo, useRef, useSyncExternalStore } from 'react'

import { cn } from '../../lib/utils'

export type ToastType = 'error' | 'success' | 'warning' | 'info' | 'loading'
type StaticToastType = Exclude<ToastType, 'loading'>

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

export interface LoadingToastConfig<T = unknown> extends ToastConfig {
  onError?: (error: unknown) => void
  promise: Promise<T>
}

export interface ToastRecord extends ToastConfig {
  key: string
  type: ToastType
}

export interface ToastLabels {
  close: string
  error: React.ReactNode
  errorDescription: React.ReactNode
  loading: React.ReactNode
  success: React.ReactNode
}

export type ToastUtilities = ReturnType<typeof getToastUtilities>
export type ToastStore = ReturnType<typeof createToastStore>

const DEFAULT_TIMEOUT = 3000
const DEFAULT_TOAST_LABELS: ToastLabels = {
  close: 'Close',
  error: 'Error',
  errorDescription: 'An error occurred',
  loading: 'Loading...',
  success: 'Success'
}

const getToastKey = (key?: string | number) => String(key ?? `toast-${Date.now()}-${Math.random()}`)

const getToastLabels = (labels?: Partial<ToastLabels>): ToastLabels => ({ ...DEFAULT_TOAST_LABELS, ...labels })

const createToastStore = () => {
  let toastQueue: ToastRecord[] = []
  const listeners = new Set<() => void>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const loadingTokens = new Map<string, symbol>()

  const notify = () => {
    listeners.forEach((listener) => listener())
  }

  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  const getSnapshot = () => toastQueue

  const clearTimer = (key: string) => {
    const timer = timers.get(key)

    if (timer) {
      clearTimeout(timer)
      timers.delete(key)
    }
  }

  const remove = (key: string) => {
    const toast = toastQueue.find((item) => item.key === key)
    clearTimer(key)
    loadingTokens.delete(key)
    toastQueue = toastQueue.filter((item) => item.key !== key)
    toast?.onClose?.()
    notify()
  }

  const schedule = (toast: ToastRecord) => {
    clearTimer(toast.key)

    if (toast.timeout === 0 || toast.type === 'loading') {
      return
    }

    const timeout = toast.timeout ?? DEFAULT_TIMEOUT
    timers.set(
      toast.key,
      setTimeout(() => {
        remove(toast.key)
      }, timeout)
    )
  }

  const upsert = (toast: ToastRecord) => {
    const existingIndex = toastQueue.findIndex((item) => item.key === toast.key)

    if (existingIndex >= 0) {
      toastQueue = toastQueue.map((item, index) => (index === existingIndex ? toast : item))
    } else {
      toastQueue = [...toastQueue, toast]
    }

    schedule(toast)
    notify()
  }

  const closeAll = () => {
    toastQueue.forEach((toast) => {
      clearTimer(toast.key)
      loadingTokens.delete(toast.key)
      toast.onClose?.()
    })
    toastQueue = []
    notify()
  }

  return {
    closeAll,
    getLoadingToken: (key: string) => loadingTokens.get(key),
    getSnapshot,
    remove,
    setLoadingToken: (key: string, token: symbol) => loadingTokens.set(key, token),
    subscribe,
    unsetLoadingToken: (key: string) => loadingTokens.delete(key),
    upsert
  }
}

const defaultToastStore = createToastStore()
const ToastStoreContext = createContext<ToastStore | null>(null)
const ToastLabelsContext = createContext<Partial<ToastLabels> | undefined>(undefined)

const upsertToast = (toast: ToastRecord, store = defaultToastStore) => {
  store.upsert(toast)
}

const createToast = (type: StaticToastType, store = defaultToastStore) => {
  return (arg: ToastConfig | string): string => {
    const config = typeof arg === 'string' ? { title: arg } : arg
    const key = getToastKey(config.key)

    upsertToast(
      {
        ...config,
        key,
        type
      },
      store
    )

    return key
  }
}

const createLoadingToast =
  (labels?: Partial<ToastLabels>, store = defaultToastStore) =>
  <T,>(args: LoadingToastConfig<T>): string => {
    const toastLabels = getToastLabels(labels)
    const { title, description, icon, onError, promise, timeout, ...restConfig } = args
    const key = getToastKey(args.key)
    const token = Symbol(key)

    store.setLoadingToken(key, token)
    upsertToast(
      {
        ...restConfig,
        description,
        icon,
        key,
        title: title || toastLabels.loading,
        timeout: 0,
        type: 'loading'
      },
      store
    )

    promise
      .then((result) => {
        if (store.getLoadingToken(key) !== token) {
          return result
        }
        store.unsetLoadingToken(key)
        upsertToast(
          {
            ...restConfig,
            description,
            key,
            title: title || toastLabels.success,
            timeout: timeout ?? 2000,
            type: 'success'
          },
          store
        )
        return result
      })
      .catch((err) => {
        if (store.getLoadingToken(key) !== token) {
          return
        }
        store.unsetLoadingToken(key)
        onError?.(err)
        upsertToast(
          {
            ...restConfig,
            description: err?.message || description || toastLabels.errorDescription,
            key,
            title: title || toastLabels.error,
            timeout: timeout ?? 0,
            type: 'error'
          },
          store
        )
      })

    return key
  }

const createToastUtilities = (labels?: Partial<ToastLabels>, store = defaultToastStore) =>
  ({
    closeAll: store.closeAll,
    closeToast: (key: string) => store.remove(key),
    error: createToast('error', store),
    getToastQueue: (): { toasts: ToastRecord[] } => ({ toasts: store.getSnapshot() }),
    info: createToast('info', store),
    loading: createLoadingToast(labels, store),
    success: createToast('success', store),
    warning: createToast('warning', store)
  }) as const

export const error = createToast('error')
export const success = createToast('success')
export const warning = createToast('warning')
export const info = createToast('info')

export const loading = createLoadingToast()

export const closeToast = (key: string) => {
  defaultToastStore.remove(key)
}

export const closeAll = () => {
  defaultToastStore.closeAll()
}

export const getToastQueue = (): { toasts: ToastRecord[] } => ({ toasts: defaultToastStore.getSnapshot() })

export const getToastUtilities = (labels?: Partial<ToastLabels>) => createToastUtilities(labels)

export const useToasts = (labels?: Partial<ToastLabels>) => {
  const store = use(ToastStoreContext) ?? defaultToastStore
  const contextLabels = use(ToastLabelsContext)
  const toastLabels = labels ?? contextLabels

  return useMemo(() => createToastUtilities(toastLabels, store), [toastLabels, store])
}

export const ToastProvider = ({ children, labels }: { children: React.ReactNode; labels?: Partial<ToastLabels> }) => {
  const storeRef = useRef<ToastStore | null>(null)

  if (!storeRef.current) {
    storeRef.current = createToastStore()
  }

  return (
    <ToastStoreContext value={storeRef.current}>
      <ToastLabelsContext value={labels}>
        {children}
        <ToastViewport labels={labels} store={storeRef.current} />
      </ToastLabelsContext>
    </ToastStoreContext>
  )
}

const typeIconMap: Record<ToastType, React.ReactNode> = {
  error: <AlertCircle className="size-4 text-destructive" />,
  success: <CheckCircle2 className="size-4 text-success" />,
  warning: <AlertTriangle className="size-4 text-warning" />,
  info: <Info className="size-4 text-info" />,
  loading: <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
}

const getToastA11yProps = (type: ToastType): Pick<React.HTMLAttributes<HTMLDivElement>, 'aria-live' | 'role'> => {
  if (type === 'warning' || type === 'error') {
    return { 'aria-live': 'assertive', role: 'alert' }
  }

  return { 'aria-live': 'polite', role: 'status' }
}

const ToastItem = ({ labels, store, toast }: { labels: ToastLabels; store: ToastStore; toast: ToastRecord }) => {
  const icon = toast.icon ?? typeIconMap[toast.type]
  const a11yProps = getToastA11yProps(toast.type)

  return (
    <div
      {...a11yProps}
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
        aria-label={labels.close}
        className="-mr-1 flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={(event) => {
          event.stopPropagation()
          store.remove(toast.key)
        }}>
        <X className="size-3.5" />
      </button>
    </div>
  )
}

export const ToastViewport = ({
  labels,
  store = defaultToastStore
}: {
  labels?: Partial<ToastLabels>
  store?: ToastStore
}) => {
  const toasts = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const toastLabels = getToastLabels(labels)

  if (toasts.length === 0) {
    return null
  }

  return (
    <div
      aria-label="notifications"
      className="-translate-x-1/2 pointer-events-none fixed top-5 left-1/2 z-[10000] flex flex-col items-center gap-2"
      role="region">
      {toasts.map((toast) => (
        <ToastItem key={toast.key} labels={toastLabels} store={store} toast={toast} />
      ))}
    </div>
  )
}
