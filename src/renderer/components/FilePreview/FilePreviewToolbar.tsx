import { createContext, type ReactNode, use, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

interface FilePreviewToolbarPortalContextValue {
  setTarget: (target: HTMLDivElement | null) => void
  target: HTMLDivElement | null
}

const FilePreviewToolbarPortalContext = createContext<FilePreviewToolbarPortalContextValue | undefined>(undefined)

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

interface FilePreviewToolbarProps {
  'aria-label': string
  children: ReactNode
}

export function FilePreviewToolbar({ 'aria-label': ariaLabel, children }: FilePreviewToolbarProps) {
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
      className="flex h-10 min-h-10 shrink-0 items-center overflow-x-auto border-border-subtle border-b px-3">
      <div className="mx-auto flex min-w-max shrink-0 items-center justify-center gap-1">{children}</div>
    </div>
  )

  return context?.target ? createPortal(toolbar, context.target) : toolbar
}
