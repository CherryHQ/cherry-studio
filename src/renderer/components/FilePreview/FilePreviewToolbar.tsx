import { SegmentedControl } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { createContext, type ReactNode, use, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

interface FilePreviewToolbarPortalContextValue {
  setTarget: (target: HTMLDivElement | null) => void
  target: HTMLDivElement | null
}

const FilePreviewToolbarPortalContext = createContext<FilePreviewToolbarPortalContextValue | undefined>(undefined)

interface FilePreviewModeToolbarPortalContextValue {
  setTarget: (target: HTMLDivElement | null) => void
  target: HTMLDivElement | null
}

const FilePreviewModeToolbarPortalContext = createContext<FilePreviewModeToolbarPortalContextValue | undefined>(
  undefined
)

export function FilePreviewToolbarPortalProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  const value = useMemo(() => ({ setTarget, target }), [target])

  return <FilePreviewToolbarPortalContext value={value}>{children}</FilePreviewToolbarPortalContext>
}

export function FilePreviewToolbarPortalHost() {
  const context = use(FilePreviewToolbarPortalContext)

  return (
    <div
      ref={context?.setTarget}
      data-testid="file-preview-toolbar-host"
      className="ml-3 flex min-w-0 max-w-[70%] items-center justify-end overflow-x-auto"
    />
  )
}

export function FilePreviewModeToolbarPortalProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  const value = useMemo(() => ({ setTarget, target }), [target])

  return <FilePreviewModeToolbarPortalContext value={value}>{children}</FilePreviewModeToolbarPortalContext>
}

export function FilePreviewModeToolbarPortalHost() {
  const context = use(FilePreviewModeToolbarPortalContext)

  if (!context) return null

  return <div ref={context.setTarget} data-testid="file-preview-mode-toolbar-host" className="contents" />
}

interface FilePreviewToolbarProps {
  'aria-label': string
  align?: 'center' | 'start'
  children: ReactNode
}

export function FilePreviewToolbar({ 'aria-label': ariaLabel, align = 'center', children }: FilePreviewToolbarProps) {
  const context = use(FilePreviewToolbarPortalContext)

  if (context && !context.target) return null

  const toolbar = context ? (
    <div role="toolbar" aria-label={ariaLabel} className="flex min-w-max shrink-0 items-center justify-end gap-1">
      {children}
    </div>
  ) : (
    <div
      role="toolbar"
      aria-label={ariaLabel}
      className="relative flex h-11 min-h-11 shrink-0 items-center overflow-x-auto px-3 after:pointer-events-none after:absolute after:right-3 after:bottom-0 after:left-3 after:border-border after:border-b after:content-['']">
      <div
        className={cn(
          'flex min-w-max shrink-0 items-center gap-1',
          align === 'center' ? 'mx-auto justify-center' : 'justify-start'
        )}>
        {children}
      </div>
    </div>
  )

  return context?.target ? createPortal(toolbar, context.target) : toolbar
}

export interface FilePreviewModeTabOption<TValue extends string = string> {
  disabled?: boolean
  icon: ReactNode
  label: string
  value: TValue
}

interface FilePreviewModeTabsProps<TValue extends string = string> {
  'aria-label': string
  disabled?: boolean
  onValueChange: (value: TValue) => void
  options: readonly FilePreviewModeTabOption<TValue>[]
  value: TValue
}

export function FilePreviewModeTabs<TValue extends string = string>({
  'aria-label': ariaLabel,
  disabled = false,
  onValueChange,
  options,
  value
}: FilePreviewModeTabsProps<TValue>) {
  const context = use(FilePreviewModeToolbarPortalContext)
  const control = (
    <SegmentedControl
      aria-label={ariaLabel}
      data-testid="file-preview-mode-tabs"
      className="h-7.5 shrink-0 rounded-md border-border-subtle bg-muted/40 [&>button]:size-6 [&>button]:rounded-sm [&>button]:p-0 [&>button]:leading-none [&>button_svg]:size-4 [&>button_svg]:shrink-0"
      disabled={disabled}
      size="sm"
      value={value}
      onValueChange={onValueChange}
      options={options.map((option) => ({
        value: option.value,
        label: option.icon,
        ariaLabel: option.label,
        disabled: option.disabled,
        tooltip: option.label
      }))}
    />
  )

  if (context) return context.target ? createPortal(control, context.target) : null

  return (
    <FilePreviewToolbar aria-label={ariaLabel} align="start">
      {control}
    </FilePreviewToolbar>
  )
}
