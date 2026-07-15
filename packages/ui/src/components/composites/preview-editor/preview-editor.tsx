import { Button } from '@cherrystudio/ui/components/primitives/button'
import { Tooltip } from '@cherrystudio/ui/components/primitives/tooltip'
import { cn } from '@cherrystudio/ui/lib/utils'
import Eye from 'lucide-react/dist/esm/icons/eye'
import Save from 'lucide-react/dist/esm/icons/save'
import SquarePen from 'lucide-react/dist/esm/icons/square-pen'
import Undo2 from 'lucide-react/dist/esm/icons/undo-2'
import * as React from 'react'

export type PreviewEditorMode = 'preview' | 'edit'

export interface PreviewEditorLabels {
  preview: React.ReactNode
  edit: React.ReactNode
  save: React.ReactNode
  discard: React.ReactNode
  unsaved?: React.ReactNode
}

export interface PreviewEditorProps extends Omit<React.ComponentPropsWithoutRef<'div'>, 'children' | 'title'> {
  mode: PreviewEditorMode
  onModeChange: (mode: PreviewEditorMode) => void
  preview: React.ReactNode
  editor: React.ReactNode
  labels: PreviewEditorLabels
  title?: React.ReactNode
  actions?: React.ReactNode
  isDirty?: boolean
  isLoading?: boolean
  isSaving?: boolean
  onSave: () => void | Promise<void>
  onDiscard: () => void
  contentClassName?: string
}

function getAccessibleLabel(label: React.ReactNode): string | undefined {
  return typeof label === 'string' ? label : undefined
}

/**
 * Controlled preview/edit work surface.
 *
 * Persistence, validation, conflicts, and draft ownership deliberately stay
 * with the consumer; this component only standardizes the shared interaction
 * and layout contract.
 */
function PreviewEditor({
  mode,
  onModeChange,
  preview,
  editor,
  labels,
  title,
  actions,
  isDirty = false,
  isLoading = false,
  isSaving = false,
  onSave,
  onDiscard,
  contentClassName,
  className,
  ...props
}: PreviewEditorProps) {
  const nextMode = mode === 'preview' ? 'edit' : 'preview'
  const modeActionLabel = nextMode === 'edit' ? labels.edit : labels.preview
  const ModeActionIcon = nextMode === 'edit' ? SquarePen : Eye

  return (
    <div data-slot="preview-editor" className={cn('flex min-h-0 flex-1 flex-col', className)} {...props}>
      <div
        data-slot="preview-editor-toolbar"
        className="flex h-10 shrink-0 items-center gap-2 border-border-subtle border-b pr-2 pl-3">
        {title && (
          <div className="flex min-w-0 flex-1 items-center gap-1.5 font-medium text-foreground text-sm">
            <span className="truncate">{title}</span>
            {isDirty && labels.unsaved && (
              <span
                className="size-1.5 shrink-0 rounded-full bg-warning"
                aria-label={typeof labels.unsaved === 'string' ? labels.unsaved : undefined}
                title={typeof labels.unsaved === 'string' ? labels.unsaved : undefined}
              />
            )}
          </div>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Tooltip content={modeActionLabel} delay={800}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={getAccessibleLabel(modeActionLabel)}
              disabled={isLoading || isSaving}
              onClick={() => onModeChange(nextMode)}>
              <ModeActionIcon size={14} />
            </Button>
          </Tooltip>
          {isDirty && (
            <>
              <Tooltip content={labels.discard} delay={800}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={getAccessibleLabel(labels.discard)}
                  disabled={isSaving}
                  onClick={onDiscard}>
                  <Undo2 size={14} />
                </Button>
              </Tooltip>
              <Tooltip content={labels.save} delay={800}>
                <Button
                  type="button"
                  variant="default"
                  size="icon-sm"
                  aria-label={getAccessibleLabel(labels.save)}
                  loading={isSaving}
                  disabled={isLoading}
                  onClick={() => void onSave()}>
                  {isSaving ? null : <Save size={14} />}
                </Button>
              </Tooltip>
            </>
          )}
          {actions && (
            <>
              <span aria-hidden className="mx-0.5 h-4 w-px bg-border-subtle" />
              <div className="flex shrink-0 items-center gap-1">{actions}</div>
            </>
          )}
        </div>
      </div>
      <div data-slot="preview-editor-content" className={cn('min-h-0 flex-1', contentClassName)}>
        {mode === 'edit' ? editor : preview}
      </div>
    </div>
  )
}

export { PreviewEditor }
