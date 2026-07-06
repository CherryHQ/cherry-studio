import {
  Alert,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Skeleton
} from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import { usePromptMutations, usePromptMutationsById } from '@renderer/hooks/resourceCatalog'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { Prompt } from '@shared/data/types/prompt'
import { Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { type KeyboardEvent, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PromptEditDialog } from '../edit'

type PromptDialogState = { prompt: Prompt | null } | null

export type PromptManagementDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function getPromptSummary(prompt: Prompt) {
  return prompt.content.replace(/\s+/g, ' ').trim()
}

function activateOnKeyDown(event: KeyboardEvent<HTMLDivElement>, action: () => void) {
  if (event.target !== event.currentTarget) return
  if (event.key !== 'Enter' && event.key !== ' ') return

  event.preventDefault()
  action()
}

export function PromptManagementDialog({ open, onOpenChange }: PromptManagementDialogProps) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [promptDialog, setPromptDialog] = useState<PromptDialogState>(null)
  const [deleteTarget, setDeleteTarget] = useState<Prompt | null>(null)
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [deletingPrompt, setDeletingPrompt] = useState(false)

  const trimmedSearch = search.trim()
  const query = useMemo(() => (trimmedSearch ? { search: trimmedSearch } : undefined), [trimmedSearch])
  const { data, error, isLoading, refetch } = useQuery('/prompts', {
    enabled: open,
    ...(query ? { query } : {})
  })
  const prompts = data ?? []
  const promptDialogPrompt = promptDialog?.prompt ?? null
  const activePrompt = promptDialogPrompt ?? deleteTarget
  const { createPrompt } = usePromptMutations()
  const { updatePrompt, deletePrompt } = usePromptMutationsById(activePrompt?.id ?? '')

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (savingPrompt || deletingPrompt) return
      onOpenChange(nextOpen)
      if (!nextOpen) {
        setPromptDialog(null)
        setDeleteTarget(null)
      }
    },
    [deletingPrompt, onOpenChange, savingPrompt]
  )

  const handleClosePromptDialog = useCallback(() => {
    if (savingPrompt) return
    setPromptDialog(null)
  }, [savingPrompt])

  const handleSavePrompt = useCallback(
    async (payload: { title: string; content: string }) => {
      setSavingPrompt(true)
      try {
        if (promptDialogPrompt) {
          await updatePrompt(payload)
        } else {
          await createPrompt(payload)
        }
        await refetch()
        setPromptDialog(null)
      } catch (err) {
        window.toast.error(
          formatErrorMessageWithPrefix(
            err,
            t(promptDialogPrompt ? 'settings.prompts.errors.updateFailed' : 'settings.prompts.errors.createFailed')
          )
        )
        throw err
      } finally {
        setSavingPrompt(false)
      }
    },
    [createPrompt, promptDialogPrompt, refetch, t, updatePrompt]
  )

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return

    setDeletingPrompt(true)
    try {
      await deletePrompt()
      await refetch()
      setDeleteTarget(null)
    } catch (err) {
      window.toast.error(formatErrorMessageWithPrefix(err, t('settings.prompts.errors.deleteFailed')))
      throw err
    } finally {
      setDeletingPrompt(false)
    }
  }, [deletePrompt, deleteTarget, refetch, t])

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent size="xl" className="flex h-[min(640px,78vh)] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 px-5 pt-5 pb-3">
            <DialogTitle>{t('settings.prompts.title')}</DialogTitle>
          </DialogHeader>

          <div className="flex shrink-0 items-center gap-3 border-border-muted border-b px-5 pb-3">
            <div className="relative min-w-0 flex-1">
              <Search size={14} className="-translate-y-1/2 absolute top-1/2 left-2.5 text-foreground-muted" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('library.toolbar.search_placeholder')}
                className="h-8 rounded-md border-input bg-background pr-8 pl-8 text-sm placeholder:text-foreground-muted"
              />
              {search ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('common.clear')}
                  onClick={() => setSearch('')}
                  className="-translate-y-1/2 absolute top-1/2 right-1 size-6 text-foreground-muted hover:text-foreground">
                  <X size={12} />
                </Button>
              ) : null}
            </div>

            <Button variant="default" size="sm" onClick={() => setPromptDialog({ prompt: null })} className="shrink-0">
              <Plus size={12} className="lucide-custom" />
              <span>{t('settings.prompts.add')}</span>
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border-muted [&::-webkit-scrollbar]:w-1">
            {error ? (
              <div className="flex min-h-full items-center justify-center">
                <Alert
                  type="error"
                  showIcon
                  message={t('common.error')}
                  description={error.message}
                  action={
                    <Button variant="outline" size="sm" onClick={() => void refetch()}>
                      {t('common.retry')}
                    </Button>
                  }
                  className="max-w-lg rounded-md px-4 py-3 shadow-none"
                />
              </div>
            ) : isLoading ? (
              <PromptListSkeleton />
            ) : prompts.length === 0 ? (
              <EmptyState
                preset={trimmedSearch ? 'no-result' : 'no-resource'}
                title={trimmedSearch ? t('library.empty_state.no_match_title') : t('library.empty_state.title')}
                description={
                  trimmedSearch ? t('library.empty_state.no_match_description') : t('library.empty_state.description')
                }
                className="py-20"
              />
            ) : (
              <div className="flex flex-col gap-2">
                {prompts.map((prompt) => (
                  <PromptRow
                    key={prompt.id}
                    prompt={prompt}
                    onEdit={() => setPromptDialog({ prompt })}
                    onDelete={() => setDeleteTarget(prompt)}
                  />
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <PromptEditDialog
        open={promptDialog !== null}
        prompt={promptDialogPrompt}
        saving={savingPrompt}
        onSave={handleSavePrompt}
        onCancel={handleClosePromptDialog}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !deletingPrompt) setDeleteTarget(null)
        }}
        title={t('settings.prompts.delete')}
        description={t('settings.prompts.deleteConfirm')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        destructive
        confirmLoading={deletingPrompt}
        onConfirm={handleConfirmDelete}
      />
    </>
  )
}

function PromptListSkeleton() {
  return (
    <div className="flex flex-col gap-2" data-testid="prompt-management-loading">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="rounded-lg border border-border-subtle bg-card p-3">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-full" />
            </div>
            <Skeleton className="size-7 rounded-md" />
            <Skeleton className="size-7 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  )
}

function PromptRow({ onDelete, onEdit, prompt }: { onDelete: () => void; onEdit: () => void; prompt: Prompt }) {
  const { t } = useTranslation()
  const summary = getPromptSummary(prompt)

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={prompt.title}
      onClick={onEdit}
      onKeyDown={(event) => activateOnKeyDown(event, onEdit)}
      className="group flex cursor-pointer items-center gap-3 rounded-lg border border-border-subtle bg-card p-3 transition-[border-color,box-shadow] hover:border-border-muted hover:shadow-sm">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground text-sm leading-5">{prompt.title}</div>
        <div className="mt-0.5 line-clamp-2 text-foreground-secondary text-xs leading-5">{summary}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('common.edit')}
          onClick={onEdit}
          className="text-foreground-muted hover:text-foreground">
          <Pencil size={12} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('common.delete')}
          onClick={onDelete}
          className="text-foreground-muted hover:bg-error-bg hover:text-error-text">
          <Trash2 size={12} />
        </Button>
      </div>
    </div>
  )
}
