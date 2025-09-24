import { addToast, closeAll, closeToast, getToastQueue, isToastClosing } from '@heroui/toast'
import type { RequireSome } from '@types'

type AddToastProps = Parameters<typeof addToast>[0]
type ToastPropsColored = Omit<AddToastProps, 'color'>

const createToast = (color: 'danger' | 'success' | 'warning' | 'default') => {
  return (arg: ToastPropsColored | string): string | null => {
    if (typeof arg === 'string') {
      return addToast({ color, title: arg })
    } else {
      return addToast({ color, ...arg })
    }
  }
}

// syntatic sugar, oh yeah

/**
 * Display an error toast notification with red color
 * @param arg - Toast content (string) or toast options object
 * @returns Toast ID or null
 */
const error = createToast('danger')

/**
 * Display a success toast notification with green color
 * @param arg - Toast content (string) or toast options object
 * @returns Toast ID or null
 */
const success = createToast('success')

/**
 * Display a warning toast notification with yellow color
 * @param arg - Toast content (string) or toast options object
 * @returns Toast ID or null
 */
const warning = createToast('warning')

/**
 * Display an info toast notification with default color
 * @param arg - Toast content (string) or toast options object
 * @returns Toast ID or null
 */
const info = createToast('default')

/**
 * Display a loading toast notification that resolves with a promise
 * @param args - Toast options object containing a promise to resolve
 * @returns Toast ID or null
 */
const loading = (args: RequireSome<AddToastProps, 'promise'>) => {
  // Disappear immediately by default
  if (args.timeout === undefined) {
    args.timeout = 1
  }
  return addToast(args)
}

export type ToastUtilities = {
  getToastQueue: typeof getToastQueue
  addToast: typeof addToast
  closeToast: typeof closeToast
  closeAll: typeof closeAll
  isToastClosing: typeof isToastClosing
  error: typeof error
  success: typeof success
  warning: typeof warning
  info: typeof info
  loading: typeof loading
}

export const getToastUtilities = (): ToastUtilities =>
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
