import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Input,
  ReorderableList,
  Skeleton,
  type SortableDragHandleProps
} from '@cherrystudio/ui'
import { useDataChange, useQuery } from '@data/hooks/useDataApi'
import { useReorder } from '@data/hooks/useReorder'
import { PromptEditDialog } from '@renderer/components/resourceCatalog/dialogs/edit'
import Scrollbar from '@renderer/components/Scrollbar'
import { SettingsContentBody, SettingTitle } from '@renderer/components/SettingsPrimitives'
import { usePromptMutations, usePromptMutationsById } from '@renderer/hooks/resourceCatalog'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { Prompt, PromptVisibility } from '@shared/data/types/prompt'
import { GripVertical, Plus, Search, Trash2, X } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type PromptDialogState = { prompt: Prompt | null } | null
type PromptFormValue = { title: string; content: string; visibility: PromptVisibility }
type PendingVisibilityChange = { payload: PromptFormValue; bindingCount: number }

const PROMPT_BINDINGS_SWR_OPTIONS = { keepPreviousData: false } as const

function getPromptSummary(prompt: Prompt) {
  return prompt.content.replace(/\s+/g, ' ').trim()
}

export function PromptSettings() {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [promptDialog, setPromptDialog] = useState<PromptDialogState>(null)
  const [deleteTarget, setDeleteTarget] = useState<Prompt | null>(null)
  const [pendingVisibilityChange, setPendingVisibilityChange] = useState<PendingVisibilityChange | null>(null)
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [deletingPrompt, setDeletingPrompt] = useState(false)
  const { data, error, isLoading, refetch } = useQuery('/prompts', {})
  const prompts = useMemo(() => data ?? [], [data])
  const normalizedSearch = search.trim().toLowerCase()
  const visiblePrompts = useMemo(() => {
    if (!normalizedSearch) return prompts
    return prompts.filter(
      (prompt) =>
        prompt.title.toLowerCase().includes(normalizedSearch) || prompt.content.toLowerCase().includes(normalizedSearch)
    )
  }, [normalizedSearch, prompts])

  const promptDialogPrompt = promptDialog?.prompt ?? null
  const activePrompt = promptDialogPrompt ?? deleteTarget
  const bindingQueryTarget =
    deleteTarget ?? (promptDialogPrompt?.visibility === 'restricted' ? promptDialogPrompt : null)
  const {
    data: activeBindings,
    isLoading: isLoadingBindings,
    refetch: refetchActiveBindings
  } = useQuery('/prompts/:id/bindings', {
    enabled: Boolean(bindingQueryTarget),
    params: { id: bindingQueryTarget?.id ?? '' },
    swrOptions: PROMPT_BINDINGS_SWR_OPTIONS
  })
  const activeBindingCount = activeBindings?.length
  const { createPrompt } = usePromptMutations()
  const { updatePrompt, deletePrompt } = usePromptMutationsById(activePrompt?.id ?? '')
  const { applyReorderedList, isPending: isReordering } = useReorder('/prompts')
  useDataChange('/prompts', () => void refetch())
  useDataChange('/prompts/:id/bindings', () => {
    if (deleteTarget) void refetchActiveBindings()
  })

  const handleSavePrompt = useCallback(
    async (payload: PromptFormValue) => {
      setSavingPrompt(true)
      try {
        if (promptDialogPrompt) {
          if (promptDialogPrompt.visibility === 'restricted' && payload.visibility === 'global') {
            const refreshedBindings = await refetchActiveBindings()
            const bindingCount = Array.isArray(refreshedBindings) ? refreshedBindings.length : activeBindings?.length
            if (bindingCount === undefined) throw new Error('Unable to load prompt bindings')
            if (bindingCount > 0) {
              setPendingVisibilityChange({ payload, bindingCount })
              return
            }
          }
          await updatePrompt(payload)
        } else {
          await createPrompt(payload)
        }
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
    [activeBindings, createPrompt, promptDialogPrompt, refetchActiveBindings, t, updatePrompt]
  )

  const handleConfirmVisibilityChange = useCallback(async () => {
    if (!pendingVisibilityChange) return

    setSavingPrompt(true)
    try {
      await updatePrompt(pendingVisibilityChange.payload)
      setPendingVisibilityChange(null)
      setPromptDialog(null)
    } catch (err) {
      toast.error(formatErrorMessageWithPrefix(err, t('settings.prompts.errors.updateFailed')))
      throw err
    } finally {
      setSavingPrompt(false)
    }
  }, [pendingVisibilityChange, t, updatePrompt])

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return

    setDeletingPrompt(true)
    try {
      await deletePrompt()
      setDeleteTarget(null)
    } catch (err) {
      toast.error(formatErrorMessageWithPrefix(err, t('settings.prompts.errors.deleteFailed')))
      throw err
    } finally {
      setDeletingPrompt(false)
    }
  }, [deletePrompt, deleteTarget, t])

  const handleReorderError = useCallback(
    (err: unknown) => {
      toast.error(formatErrorMessageWithPrefix(err, t('settings.prompts.errors.reorderFailed')))
    },
    [t]
  )

  return (
    <SettingsContentBody className="min-h-0 flex-1 overflow-hidden pt-4" innerClassName="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3">
        <SettingTitle className="m-0">{t('settings.prompts.title')}</SettingTitle>
        <Button size="sm" onClick={() => setPromptDialog({ prompt: null })}>
          <Plus size={12} />
          {t('settings.prompts.add')}
        </Button>
      </div>

      <div className="relative mb-3 shrink-0">
        <Search size={14} className="-translate-y-1/2 absolute top-1/2 left-2.5 text-foreground-tertiary" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('settings.prompts.searchPlaceholder')}
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

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-subtle bg-card">
        {error ? (
          <div className="flex min-h-full items-center justify-center p-4">
            <Alert
              type="error"
              showIcon
              message={t('settings.prompts.errors.loadFailed')}
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
        ) : visiblePrompts.length === 0 ? (
          <EmptyState
            compact
            preset={normalizedSearch ? 'no-result' : 'no-resource'}
            title={normalizedSearch ? t('library.empty_state.no_match_title') : t('settings.prompts.noPrompts')}
            description={normalizedSearch ? t('library.empty_state.no_match_description') : undefined}
            className="py-14"
          />
        ) : (
          <Scrollbar className="min-h-0 flex-1">
            <ReorderableList
              items={prompts}
              visibleItems={visiblePrompts}
              getId={(prompt) => prompt.id}
              onReorder={applyReorderedList}
              onReorderError={handleReorderError}
              disabled={savingPrompt || deletingPrompt || isReordering}
              dragHandle
              gap={0}
              className="divide-y divide-border-subtle"
              restrictions={{ scrollableAncestor: true }}
              renderItem={(prompt, _index, state) => (
                <PromptRow
                  prompt={prompt}
                  dragHandleProps={state.dragHandleProps}
                  onEdit={() => setPromptDialog({ prompt })}
                  onDelete={() => setDeleteTarget(prompt)}
                />
              )}
            />
          </Scrollbar>
        )}
      </div>

      <PromptEditDialog
        open={promptDialog !== null}
        prompt={promptDialogPrompt}
        saving={savingPrompt}
        onSave={handleSavePrompt}
        onCancel={() => {
          if (!savingPrompt) setPromptDialog(null)
        }}
      />

      <ConfirmDialog
        open={pendingVisibilityChange !== null}
        onOpenChange={(open) => {
          if (!open && !savingPrompt) setPendingVisibilityChange(null)
        }}
        title={t('settings.prompts.visibility.makeGlobalConfirmTitle')}
        description={t('settings.prompts.visibility.makeGlobalConfirmDescription', {
          count: pendingVisibilityChange?.bindingCount ?? 0
        })}
        confirmText={t('common.confirm')}
        cancelText={t('common.cancel')}
        destructive
        confirmLoading={savingPrompt}
        onConfirm={handleConfirmVisibilityChange}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deletingPrompt) setDeleteTarget(null)
        }}
        title={t('settings.prompts.delete')}
        description={
          deleteTarget?.visibility === 'restricted'
            ? isLoadingBindings || activeBindingCount === undefined
              ? t('settings.prompts.deleteRestrictedConfirm')
              : activeBindingCount > 0
                ? t('settings.prompts.deleteSharedConfirm', { count: activeBindingCount })
                : t('settings.prompts.deleteConfirm')
            : deleteTarget?.visibility === 'global'
              ? t('settings.prompts.deleteGlobalConfirm')
              : t('settings.prompts.deleteConfirm')
        }
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        destructive
        confirmLoading={deletingPrompt}
        onConfirm={handleConfirmDelete}
      />
    </SettingsContentBody>
  )
}

function PromptListSkeleton() {
  return (
    <div className="space-y-3 p-4" data-testid="prompt-settings-loading">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="size-6 rounded-md" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-full" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  )
}

function PromptRow({
  dragHandleProps,
  onDelete,
  onEdit,
  prompt
}: {
  dragHandleProps?: SortableDragHandleProps
  onDelete: () => void
  onEdit: () => void
  prompt: Prompt
}) {
  const { t } = useTranslation()
  const summary = getPromptSummary(prompt)

  return (
    <div className="group flex items-center gap-3 bg-card px-3 py-2.5 transition-colors hover:bg-accent/30">
      <button
        ref={dragHandleProps?.ref}
        type="button"
        {...dragHandleProps?.attributes}
        {...dragHandleProps?.listeners}
        aria-label={t('settings.prompts.reorder', { title: prompt.title })}
        onClick={(event) => event.stopPropagation()}
        className="flex size-7 shrink-0 cursor-grab items-center justify-center rounded-md text-foreground-tertiary hover:bg-accent/50 hover:text-foreground active:cursor-grabbing">
        <GripVertical size={14} />
      </button>
      <Button
        variant="ghost"
        aria-label={`${t('common.edit')} ${prompt.title}`}
        onClick={onEdit}
        className="h-auto min-w-0 flex-1 justify-start whitespace-normal rounded-md p-0 text-left hover:bg-transparent">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-foreground text-sm leading-5">{prompt.title}</span>
          <span className="mt-0.5 line-clamp-2 block text-muted-foreground text-xs leading-5">{summary}</span>
        </span>
      </Button>
      <Badge variant="secondary" className="border-0 font-normal text-muted-foreground">
        {t(
          prompt.visibility === 'global'
            ? 'settings.prompts.visibility.global.badge'
            : 'settings.prompts.visibility.restricted.badge'
        )}
      </Badge>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`${t('common.delete')} ${prompt.title}`}
          onClick={onDelete}
          className="text-muted-foreground hover:bg-error-subtle hover:text-error-subtle-foreground">
          <Trash2 size={12} />
        </Button>
      </div>
    </div>
  )
}
