import type { ReactNode } from 'react'

/**
 * Toast type variants
 */
type ToastType = 'info' | 'warning' | 'error' | 'success' | 'loading'

/**
 * Button configuration for toast actions
 */
interface ToastButton {
  /** Icon to display in the button */
  icon?: ReactNode
  /** Button label text */
  label: string
  /** Click handler for the button */
  onClick: () => void
}

/**
 * Link configuration for toast navigation
 */
interface ToastLink {
  /** Link label text */
  label: string
  /** URL to navigate to */
  href?: string
  /** Click handler for the link */
  onClick?: () => void
}

/**
 * Base toast properties
 */
interface ToastProps {
  /** Unique identifier for the toast */
  id: string | number
  /** Type of toast notification */
  type: ToastType
  /** Main title text */
  title: string
  /** Optional description text */
  description?: string
  /** Optional colored message text */
  coloredMessage?: string
  /** Whether to use colored background for the toast */
  coloredBackground?: boolean
  /** Whether the toast can be dismissed */
  dismissable?: boolean
  /** Callback when toast is dismissed */
  onDismiss?: () => void
  /** Optional action button */
  button?: ToastButton
  /** Optional navigation link */
  link?: ToastLink
  /** Promise to track for loading state */
  promise?: Promise<unknown>
}

/**
 * Props for quick toast API methods (without type field)
 */
interface QuickToastProps extends Omit<ToastProps, 'type' | 'id'> {}

/**
 * Props for loading toast (requires promise)
 */
interface QuickLoadingProps extends QuickToastProps {
  promise: ToastProps['promise']
}

/**
 * Toast notification interface with type-safe methods
 */
interface toast {
  /**
   * Display a custom toast notification
   * @param props - Toast configuration (must include type)
   * @returns Toast ID
   * @example
   * toast({
   *   type: 'info',
   *   title: 'Hello',
   *   description: 'This is a toast'
   * })
   */
  (props: Omit<ToastProps, 'id'>): string | number

  /**
   * Display an info toast notification
   * @param props - Toast configuration (type is automatically set to 'info')
   * @example
   * toast.info({
   *   title: 'Information',
   *   description: 'This is an info message'
   * })
   */
  info: (props: QuickToastProps) => void

  /**
   * Display a success toast notification
   * @param props - Toast configuration (type is automatically set to 'success')
   * @example
   * toast.success({
   *   title: 'Success!',
   *   description: 'Operation completed successfully'
   * })
   */
  success: (props: QuickToastProps) => void

  /**
   * Display a warning toast notification
   * @param props - Toast configuration (type is automatically set to 'warning')
   * @example
   * toast.warning({
   *   title: 'Warning',
   *   description: 'Please be careful'
   * })
   */
  warning: (props: QuickToastProps) => void

  /**
   * Display an error toast notification
   * @param props - Toast configuration (type is automatically set to 'error')
   * @example
   * toast.error({
   *   title: 'Error',
   *   description: 'Something went wrong'
   * })
   */
  error: (props: QuickToastProps) => void

  /**
   * Display a loading toast notification with promise tracking
   * @param props - Toast configuration (type is automatically set to 'loading', requires promise)
   * @example
   * toast.loading({
   *   title: 'Loading...',
   *   promise: fetchData()
   * })
   */
  loading: (props: QuickLoadingProps) => void

  /**
   * Dismiss a toast notification by its ID
   * @param id - The ID of the toast to dismiss
   * @example
   * const toastId = toast.info({ title: 'Info' })
   * toast.dismiss(toastId)
   */
  dismiss: (id: string | number) => void
}

// Export types for external use
export type { QuickLoadingProps, QuickToastProps, ToastButton, ToastLink, ToastProps, ToastType }
