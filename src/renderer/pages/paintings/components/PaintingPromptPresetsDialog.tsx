import { GripVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ReorderableList,
  Scrollbar,
  Skeleton
} from '@cherrystudio/ui'
import { useDataChange, useQuery } from '@data/hooks/useDataApi'
import { useReorder } from '@data/hooks/useReorder'
import { PromptEditDialog } from '@renderer/components/resourceCatalog/dialogs/edit'
import { usePromptMutations, usePromptMutationsById } from '@renderer/hooks/resourceCatalog'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { ListPromptsQueryParams } from '@shared/data/api/schemas/prompts'
import type { Prompt, PromptVisibility } from '@shared/data/types/prompt'

interface PaintingPromptPresetsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onApply: (content: string) => void
}

const query: ListPromptsQueryParams = { visibility: 'global' }

type PromptFormValue = { title: string; content: string; visibility: PromptVisibility }

export function PaintingPromptPresetsDialog({ open, onOpenChange, onApply }: PaintingPromptPresetsDialogProps) {
  const { t } = useTranslation()
  const { data, error, isLoading, refetch } = useQuery('/prompts', { query, enabled: open })
  const { applyReorderedList, isPending: reordering } = useReorder('/prompts', { query })
  const [editor, setEditor] = useState<{ prompt: Prompt | null } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Prompt | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { createPrompt } = usePromptMutations()
  const { updatePrompt } = usePromptMutationsById(editor?.prompt?.id ?? '')
  const { deletePrompt } = usePromptMutationsById(deleteTarget?.id ?? '')
  const busy = saving || deleting || reordering

  useDataChange('/prompts', () => {
    if (open) void refetch()
  })

  const save = async (value: PromptFormValue) => {
    setSaving(true)
    try {
      if (editor?.prompt) await updatePrompt(value)
      else await createPrompt(value)
      setEditor(null)
    } catch (err) {
      toast.error(
        formatErrorMessageWithPrefix(
          err,
          t(editor?.prompt ? 'settings.prompts.errors.updateFailed' : 'settings.prompts.errors.createFailed')
        )
      )
      throw err
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    setDeleting(true)
    try {
      await deletePrompt()
      setDeleteTarget(null)
      return true
    } catch (err) {
      toast.error(formatErrorMessageWithPrefix(err, t('settings.prompts.errors.deleteFailed')))
      return false
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy && !editor && !deleteTarget) onOpenChange(nextOpen)
      }}>
      <DialogContent
        data-ui="paintings.prompt-presets"
        closeLabel={t('common.close')}
        aria-describedby={undefined}
        size="lg">
        <DialogHeader>
          <DialogTitle>{t('settings.prompts.manageGlobal')}</DialogTitle>
        </DialogHeader>
        <Button
          data-ui="part:prompt-preset-add"
          size="sm"
          disabled={busy}
          className="justify-self-start"
          onClick={() => setEditor({ prompt: null })}>
          <Plus className="size-4" />
          {t('settings.prompts.add')}
        </Button>
        <Scrollbar className="max-h-[60vh] overflow-y-auto" data-ui="part:prompt-preset-list">
          {error ? (
            <div role="alert" className="flex flex-col items-center gap-3 py-8">
              <span>{t('settings.prompts.errors.loadFailed')}</span>
              <Button variant="outline" onClick={() => void refetch()}>
                {t('common.retry')}
              </Button>
            </div>
          ) : isLoading ? (
            <div role="status" aria-label={t('common.loading')} className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : !data?.length ? (
            <EmptyState compact title={t('settings.prompts.noPrompts')} />
          ) : (
            <ReorderableList
              items={data}
              getId={(prompt) => prompt.id}
              onReorder={applyReorderedList}
              onReorderError={(err) => {
                toast.error(formatErrorMessageWithPrefix(err, t('settings.prompts.errors.reorderFailed')))
              }}
              disabled={busy || editor !== null || deleteTarget !== null}
              dragHandle
              gap={8}
              restrictions={{ scrollableAncestor: true }}
              renderItem={(prompt, _index, state) => (
                <div
                  data-ui="part:prompt-preset-row"
                  data-prompt-id={prompt.id}
                  className="flex items-center gap-2 rounded-lg border border-border p-2">
                  <Button
                    ref={state.dragHandleProps?.ref}
                    {...state.dragHandleProps?.attributes}
                    {...state.dragHandleProps?.listeners}
                    data-ui="part:prompt-preset-drag"
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    aria-label={t('settings.prompts.reorder', { title: prompt.title })}
                    title={t('settings.prompts.reorder', { title: prompt.title })}>
                    <GripVertical className="size-4" />
                  </Button>
                  <Button
                    data-ui="part:prompt-preset-apply"
                    variant="ghost"
                    disabled={busy}
                    className="min-w-0 flex-1 justify-start"
                    aria-label={prompt.title}
                    onClick={() => {
                      onApply(prompt.content)
                      onOpenChange(false)
                    }}>
                    <span className="truncate">{prompt.title}</span>
                  </Button>
                  <Button
                    data-ui="part:prompt-preset-edit"
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    aria-label={t('settings.prompts.edit')}
                    onClick={() => setEditor({ prompt })}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    data-ui="part:prompt-preset-delete"
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    aria-label={t('settings.prompts.delete')}
                    onClick={() => setDeleteTarget(prompt)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              )}
            />
          )}
        </Scrollbar>
        <PromptEditDialog
          open={editor !== null}
          prompt={editor?.prompt}
          saving={saving}
          onSave={save}
          onCancel={() => {
            if (!saving) setEditor(null)
          }}
        />
        <ConfirmDialog
          open={deleteTarget !== null}
          onOpenChange={(nextOpen) => {
            if (!nextOpen && !deleting) setDeleteTarget(null)
          }}
          title={t('settings.prompts.delete')}
          description={t('settings.prompts.deleteGlobalConfirm')}
          confirmText={t('common.delete')}
          cancelText={t('common.cancel')}
          destructive
          confirmLoading={deleting}
          cancelDisabled={deleting}
          onConfirm={remove}
        />
      </DialogContent>
    </Dialog>
  )
}
