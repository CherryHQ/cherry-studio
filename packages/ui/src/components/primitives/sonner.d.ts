import type { ReactNode } from 'react'
import type { Action, ExternalToast, ToastClassnames } from 'sonner'

/**
 * Unique identifier for the toast
 */
type ToastIdType = string | number

/**
 * Base toast properties shared across all toast types
 */
interface BaseToastProps {
  /** Main toast message content */
  title: ReactNode
  /** Optional detailed description */
  description?: ReactNode
  /** Whether to apply colored background styling */
  colored?: boolean
  /** Duration in milliseconds before auto-dismissal */
  duration?: number
  /** Whether the toast can be manually dismissed */
  dismissable?: boolean
  /** Callback function when toast is dismissed */
  onDismiss?: () => void
  /** Action button or custom React node */
  button?: Action | ReactNode
  /** Custom class names for toast sub-components */
  classNames?: ToastClassnames
}

/**
 * Info toast properties
 */
interface InfoToastProps extends BaseToastProps {
  type?: 'info'
}

/**
 * Warning toast properties
 */
interface WarningToastProps extends BaseToastProps {
  type: 'warning'
}

/**
 * Error toast properties
 */
interface ErrorToastProps extends BaseToastProps {
  type: 'error'
}

/**
 * Success toast properties
 */
interface SuccessToastProps extends BaseToastProps {
  type: 'success'
}

/**
 * Loading toast properties
 */
interface LoadingToastProps<ToastData = unknown> extends BaseToastProps {
  type: 'loading'
  /** Optional promise to track for auto-dismissal when settled */
  promise?: Promise<ToastData>
}

/**
 * Custom toast properties
 */
interface CustomToastProps {
  type: 'custom'
  /** Custom JSX render function receiving toast ID */
  jsx: (id: ToastIdType) => React.ReactElement
  /** Additional toast configuration */
  data: ExternalToast
}

/**
 * Discriminated union of all toast types
 */
type ToastProps<ToastData = unknown> =
  | InfoToastProps
  | WarningToastProps
  | ErrorToastProps
  | SuccessToastProps
  | LoadingToastProps<ToastData>
  | CustomToastProps

/**
 * Props for quick toast API methods (excluding type-specific fields)
 */
interface QuickApiProps extends Omit<BaseToastProps, 'type'> {}

/**
 * Props for loading toast quick API (with optional promise)
 */
interface QuickLoadingProps<ToastData = unknown> extends QuickApiProps {
  /** Optional promise to track for auto-dismissal when settled */
  promise?: LoadingToastProps<ToastData>['promise']
}

/**
 * Props for custom toast quick API
 */
interface QuickCustomProps {
  /** Custom JSX render function receiving toast ID */
  jsx: CustomToastProps['jsx']
  /** Additional toast configuration */
  data: CustomToastProps['data']
}

/**
 * Toast notification interface with type-safe methods
 */
interface toast {
  /**
   * Display a custom toast notification
   * @param props - Toast configuration with discriminated type
   * @returns Toast ID
   * @example
   * toast({
   *   type: 'info',
   *   title: 'Hello',
   *   description: 'This is a toast'
   * })
   */
  <ToastData = unknown>(props: ToastProps<ToastData>): ToastIdType

  /**
   * Display an info toast notification
   * @param message - Toast message content
   * @param data - Optional additional configuration
   * @returns Toast ID
   * @example
   * toast.info('Information message', {
   *   description: 'This is an info message'
   * })
   */
  info: (message: ReactNode, data?: QuickApiProps) => ToastIdType

  /**
   * Display a success toast notification
   * @param message - Toast message content
   * @param data - Optional additional configuration
   * @returns Toast ID
   * @example
   * toast.success('Success!', {
   *   description: 'Operation completed successfully'
   * })
   */
  success: (message: ReactNode, data?: QuickApiProps) => ToastIdType

  /**
   * Display a warning toast notification
   * @param message - Toast message content
   * @param data - Optional additional configuration
   * @returns Toast ID
   * @example
   * toast.warning('Warning', {
   *   description: 'Please be careful'
   * })
   */
  warning: (message: ReactNode, data?: QuickApiProps) => ToastIdType

  /**
   * Display an error toast notification
   * @param message - Toast message content
   * @param data - Optional additional configuration
   * @returns Toast ID
   * @example
   * toast.error('Error', {
   *   description: 'Something went wrong'
   * })
   */
  error: (message: ReactNode, data?: QuickApiProps) => ToastIdType

  /**
   * Display a loading toast notification with optional promise tracking
   * @param message - Toast message content
   * @param data - Additional configuration with optional promise
   * @returns Toast ID
   * @example
   * toast.loading('Loading...', {
   *   promise: fetchData()
   * })
   */
  loading: <ToastData = unknown>(message: ReactNode, data?: QuickLoadingProps<ToastData>) => ToastIdType

  /**
   * Display a custom toast notification
   * @param props - Custom toast configuration
   * @returns Toast ID
   * @example
   * toast.custom({
   *   jsx: (id) => <div>Custom toast {id}</div>,
   *   data: { duration: 5000 }
   * })
   */
  custom: (props: QuickCustomProps) => ToastIdType

  /**
   * Dismiss a toast notification by its ID
   * @param id - The ID of the toast to dismiss
   * @example
   * const toastId = toast.info('Info')
   * toast.dismiss(toastId)
   */
  dismiss: (id: ToastIdType) => void
}

// Export types for external use
export type {
  BaseToastProps,
  CustomToastProps,
  ErrorToastProps,
  InfoToastProps,
  LoadingToastProps,
  QuickApiProps,
  QuickCustomProps,
  QuickLoadingProps,
  SuccessToastProps,
  ToastIdType,
  ToastProps,
  WarningToastProps
}
