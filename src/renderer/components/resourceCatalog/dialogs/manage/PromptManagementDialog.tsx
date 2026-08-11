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
import { usePromptBindingMutations, usePromptMutations, usePromptMutationsById } from '@renderer/hooks/resourceCatalog'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { Prompt, PromptBindingTarget } from '@shared/data/types/prompt'
import { Link2, Pencil, Plus, Search, Trash2, Unlink, X } from 'lucide-react'
import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PromptEditDialog } from '../edit'

type PromptDialogState = { prompt: Prompt | null } | null

export type PromptManagementDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  bindingTarget?: PromptBindingTarget
}

type PromptView = 'all' | 'current'

function getPromptSummary(prompt: Prompt) {
  return prompt.content.replace(/\s+/g, ' ').trim()
}

function activateOnKeyDown(event: KeyboardEvent<HTMLDivElement>, action: () => void) {
  if (event.target !== event.currentTarget) return
  if (event.key !== 'Enter' && event.key !== ' ') return

  event.preventDefault()
  action()
}

export function PromptManagementDialog({ open, onOpenChange, bindingTarget }: PromptManagementDialogProps) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [view, setView] = useState<PromptView>('all')
  const [promptDialog, setPromptDialog] = useState<PromptDialogState>(null)
  const [deleteTarget, setDeleteTarget] = useState<Prompt | null>(null)
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [deletingPrompt, setDeletingPrompt] = useState(false)
  const [bindingPromptId, setBindingPromptId] = useState<string | null>(null)

  const trimmedSearch = search.trim()
  const searchQuery = useMemo(() => (trimmedSearch ? { search: trimmedSearch } : undefined), [trimmedSearch])
  const {
    data: allPromptsData,
    error: allPromptsError,
    isLoading: isAllPromptsLoading,
    refetch: refetchAllPrompts
  } = useQuery('/prompts', {
    enabled: open && view === 'all',
    ...(searchQuery ? { query: searchQuery } : {})
  })
  const {
    data: boundPromptsData,
    error: boundPromptsError,
    isLoading: isBoundPromptsLoading,
    refetch: refetchBoundPrompts
  } = useQuery('/prompts', {
    enabled: open && bindingTarget !== undefined,
    ...(bindingTarget
      ? {
          query: {
            ...searchQuery,
            targetType: bindingTarget.type,
            targetId: bindingTarget.id
          }
        }
      : {})
  })
  const prompts = (view === 'current' ? boundPromptsData : allPromptsData) ?? []
  const error = view === 'current' ? boundPromptsError : allPromptsError
  const isLoading = view === 'current' ? isBoundPromptsLoading : isAllPromptsLoading
  const refetch = view === 'current' ? refetchBoundPrompts : refetchAllPrompts
  const boundPromptIds = useMemo(() => new Set((boundPromptsData ?? []).map((prompt) => prompt.id)), [boundPromptsData])
  const promptDialogPrompt = promptDialog?.prompt ?? null
  const activePrompt = promptDialogPrompt ?? deleteTarget
  const { createPrompt } = usePromptMutations()
  const { updatePrompt, deletePrompt } = usePromptMutationsById(activePrompt?.id ?? '')
  const { bindPrompt, unbindPrompt } = usePromptBindingMutations()

  useEffect(() => {
    if (!bindingTarget && view === 'current') {
      setView('all')
    }
  }, [bindingTarget, view])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (savingPrompt || deletingPrompt) return
      onOpenChange(nextOpen)
      if (!nextOpen) {
        setPromptDialog(null)
        setDeleteTarget(null)
        setBindingPromptId(null)
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
        toast.error(
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
      toast.error(formatErrorMessageWithPrefix(err, t('settings.prompts.errors.deleteFailed')))
      throw err
    } finally {
      setDeletingPrompt(false)
    }
  }, [deletePrompt, deleteTarget, refetch, t])

  const handleToggleBinding = useCallback(
    async (prompt: Prompt, isBound: boolean) => {
      if (!bindingTarget) return

      setBindingPromptId(prompt.id)
      try {
        if (isBound) {
          await unbindPrompt(prompt.id, bindingTarget)
        } else {
          await bindPrompt(prompt.id, bindingTarget)
        }
        await refetchBoundPrompts()
      } catch (err) {
        toast.error(
          formatErrorMessageWithPrefix(
            err,
            t(isBound ? 'settings.prompts.errors.unbindFailed' : 'settings.prompts.errors.bindFailed')
          )
        )
      } finally {
        setBindingPromptId(null)
      }
    },
    [bindPrompt, bindingTarget, refetchBoundPrompts, t, unbindPrompt]
  )

  const currentViewLabel = bindingTarget
    ? t(
        bindingTarget.type === 'assistant'
          ? 'settings.prompts.binding.currentAssistant'
          : 'settings.prompts.binding.currentAgent'
      )
    : ''

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent size="xl" className="flex h-[min(640px,78vh)] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 px-5 pt-5 pb-3">
            <DialogTitle>{t('settings.prompts.title')}</DialogTitle>
          </DialogHeader>

          <div className="flex shrink-0 items-center gap-3 border-border-subtle border-b px-5 pb-3">
            {bindingTarget ? (
              <div className="flex shrink-0 rounded-md bg-secondary p-0.5">
                <Button
                  variant={view === 'all' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setView('all')}
                  className="h-7 px-2.5 text-xs shadow-none">
                  {t('settings.prompts.allPrompts')}
                </Button>
                <Button
                  variant={view === 'current' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setView('current')}
                  className="h-7 px-2.5 text-xs shadow-none">
                  {currentViewLabel}
                </Button>
              </div>
            ) : null}

            <div className="relative min-w-0 flex-1">
              <Search size={14} className="-translate-y-1/2 absolute top-1/2 left-2.5 text-foreground-tertiary" />
              <Input
                autoFocus
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('library.toolbar.search_placeholder')}
                className="h-8 rounded-md border-input bg-background pr-8 pl-8 text-sm placeholder:text-muted-foreground"
              />
              {search ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('common.clear')}
                  onClick={() => setSearch('')}
                  className="-translate-y-1/2 absolute top-1/2 right-1 size-6 text-muted-foreground hover:text-foreground">
                  <X size={12} />
                </Button>
              ) : null}
            </div>

            <Button variant="default" size="sm" onClick={() => setPromptDialog({ prompt: null })} className="shrink-0">
              <Plus size={12} className="lucide-custom" />
              <span>{t('settings.prompts.add')}</span>
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--scrollbar-thumb)] [&::-webkit-scrollbar]:w-1">
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
                title={
                  trimmedSearch
                    ? t('library.empty_state.no_match_title')
                    : view === 'current'
                      ? t('settings.prompts.noBoundPrompts')
                      : t('library.empty_state.title')
                }
                description={
                  trimmedSearch
                    ? t('library.empty_state.no_match_description')
                    : view === 'current'
                      ? t('settings.prompts.binding.noBoundDescription')
                      : t('library.empty_state.description')
                }
                className="py-20"
              />
            ) : (
              <div className="flex flex-col gap-2">
                {prompts.map((prompt) => (
                  <PromptRow
                    key={prompt.id}
                    prompt={prompt}
                    bindingTarget={bindingTarget}
                    isBound={boundPromptIds.has(prompt.id)}
                    bindingPending={bindingPromptId === prompt.id}
                    onEdit={() => setPromptDialog({ prompt })}
                    onDelete={() => setDeleteTarget(prompt)}
                    onToggleBinding={() => void handleToggleBinding(prompt, boundPromptIds.has(prompt.id))}
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

function PromptRow({
  bindingPending,
  bindingTarget,
  isBound,
  onDelete,
  onEdit,
  onToggleBinding,
  prompt
}: {
  bindingPending: boolean
  bindingTarget?: PromptBindingTarget
  isBound: boolean
  onDelete: () => void
  onEdit: () => void
  onToggleBinding: () => void
  prompt: Prompt
}) {
  const { t } = useTranslation()
  const summary = getPromptSummary(prompt)

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={prompt.title}
      onClick={onEdit}
      onKeyDown={(event) => activateOnKeyDown(event, onEdit)}
      className="group flex cursor-pointer items-center gap-3 rounded-lg border border-border-subtle bg-card p-3 transition-[border-color,box-shadow] hover:border-border-subtle hover:shadow-sm">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground text-sm leading-5">{prompt.title}</div>
        <div className="mt-0.5 line-clamp-2 text-muted-foreground text-xs leading-5">{summary}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>
        {bindingTarget ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t(isBound ? 'settings.prompts.binding.unbindCurrent' : 'settings.prompts.binding.bindCurrent')}
            onClick={onToggleBinding}
            loading={bindingPending}
            disabled={bindingPending}
            className="text-muted-foreground hover:text-foreground">
            {isBound ? <Unlink size={12} /> : <Link2 size={12} />}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('common.edit')}
          onClick={onEdit}
          className="text-muted-foreground hover:text-foreground">
          <Pencil size={12} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('common.delete')}
          onClick={onDelete}
          className="text-muted-foreground hover:bg-error-subtle hover:text-error-subtle-foreground">
          <Trash2 size={12} />
        </Button>
      </div>
    </div>
  )
}
