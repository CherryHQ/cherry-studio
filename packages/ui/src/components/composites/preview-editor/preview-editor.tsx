import { Button } from '@cherrystudio/ui/components/primitives/button'
import { SegmentedControl } from '@cherrystudio/ui/components/primitives/segmented-control'
import { cn } from '@cherrystudio/ui/lib/utils'
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
  const showDraftActions = mode === 'edit' || isDirty
  const modeOptions = React.useMemo(
    () => [
      { value: 'preview' as const, label: labels.preview },
      { value: 'edit' as const, label: labels.edit }
    ],
    [labels.edit, labels.preview]
  )

  return (
    <div data-slot="preview-editor" className={cn('flex min-h-0 flex-1 flex-col', className)} {...props}>
      <div
        data-slot="preview-editor-toolbar"
        className="flex min-h-10 shrink-0 items-center gap-2 border-border-subtle border-b px-2">
        {title && (
          <div className="flex min-w-0 flex-1 items-center gap-1.5 pl-1 font-medium text-foreground text-sm">
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
        <SegmentedControl
          aria-label={typeof labels.edit === 'string' ? labels.edit : undefined}
          options={modeOptions}
          value={mode}
          size="sm"
          disabled={isLoading || isSaving}
          onValueChange={onModeChange}
        />
        {showDraftActions && (
          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" variant="ghost" size="sm" disabled={!isDirty || isSaving} onClick={onDiscard}>
              {labels.discard}
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              loading={isSaving}
              disabled={!isDirty || isLoading}
              onClick={() => void onSave()}>
              {labels.save}
            </Button>
          </div>
        )}
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      <div data-slot="preview-editor-content" className={cn('min-h-0 flex-1', contentClassName)}>
        {mode === 'edit' ? editor : preview}
      </div>
    </div>
  )
}

export { PreviewEditor }
