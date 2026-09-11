import { GripVertical, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmojiIcon,
  EmptyState,
  ReorderableList,
  Scrollbar,
  Skeleton,
  type SortableDragHandleProps
} from '@cherrystudio/ui'
import { useDataChange, useQuery } from '@data/hooks/useDataApi'
import { useReorder } from '@data/hooks/useReorder'
import CollapsibleSearchBar from '@renderer/components/CollapsibleSearchBar'
import { PromptEditDialog } from '@renderer/components/resourceCatalog/dialogs/edit'
import { SettingsContentBody, SettingTitle } from '@renderer/components/SettingsPrimitives'
import {
  agentAdapter,
  assistantAdapter,
  usePromptMutations,
  usePromptMutationsById
} from '@renderer/hooks/resourceCatalog'
import { toast } from '@renderer/services/toast'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { DataApiError, ErrorCode } from '@shared/data/api/errors'
import type { Prompt, PromptBindingRelation, PromptBindingTarget, PromptVisibility } from '@shared/data/types/prompt'

import { type PromptTargetOption, PromptTargetPopover } from './PromptTargetPopover'

type PromptDialogState = { prompt: Prompt | null } | null
type PromptFormValue = { title: string; content: string; visibility: PromptVisibility }
type PendingVisibilityChange = { payload: PromptFormValue; bindings: PromptBindingTarget[] }

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
  const {
    data: bindingsData,
    error: bindingsError,
    isLoading: isLoadingAllBindings,
    refetch: refetchAllBindings
  } = useQuery('/prompt-bindings', {})
  const bindings = useMemo<PromptBindingRelation[]>(() => bindingsData ?? [], [bindingsData])
  const bindingsByPrompt = useMemo(() => {
    const groupedBindings = new Map<string, PromptBindingRelation[]>()
    for (const binding of bindings) {
      const promptBindings = groupedBindings.get(binding.promptId) ?? []
      promptBindings.push(binding)
      groupedBindings.set(binding.promptId, promptBindings)
    }
    return groupedBindings
  }, [bindings])
  const hasRestrictedPrompts = prompts.some((prompt) => prompt.visibility === 'restricted')
  const {
    data: assistantData,
    error: assistantsError,
    isLoading: isLoadingAssistants,
    refetch: refetchAssistants
  } = assistantAdapter.useList({ enabled: hasRestrictedPrompts })
  const {
    data: agentData,
    error: agentsError,
    isLoading: isLoadingAgents,
    refetch: refetchAgents
  } = agentAdapter.useList({ enabled: hasRestrictedPrompts })
  const targetOptions = useMemo<PromptTargetOption[]>(
    () => [
      ...assistantData.map((assistant) => ({
        value: `assistant:${assistant.id}`,
        label: assistant.name,
        group: t('common.assistant_other'),
        target: { type: 'assistant' as const, id: assistant.id },
        icon: <EmojiIcon emoji={assistant.emoji || '💬'} size={24} fontSize={14} className="mr-0" />
      })),
      ...agentData.map((agent) => ({
        value: `agent:${agent.id}`,
        label: agent.name,
        group: t('common.agent_other'),
        target: { type: 'agent' as const, id: agent.id },
        icon: (
          <EmojiIcon
            emoji={getAgentAvatarFromConfiguration(agent.configuration)}
            size={24}
            fontSize={14}
            className="mr-0"
          />
        )
      }))
    ],
    [agentData, assistantData, t]
  )
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
  useDataChange('/prompt-bindings', () => void refetchAllBindings())
  useDataChange(['/assistants', '/agents'], () => {
    refetchAssistants()
    refetchAgents()
  })
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
            if (!Array.isArray(refreshedBindings)) throw new Error('Unable to load prompt bindings')
            if (refreshedBindings.length > 0) {
              setPendingVisibilityChange({ payload, bindings: refreshedBindings })
              return
            }
            await updatePrompt({ ...payload, expectedBindings: refreshedBindings })
          } else {
            await updatePrompt(payload)
          }
        } else {
          await createPrompt(payload)
        }
        setPromptDialog(null)
      } catch (err) {
        if (
          err instanceof DataApiError &&
          err.code === ErrorCode.CONCURRENT_MODIFICATION &&
          promptDialogPrompt?.visibility === 'restricted' &&
          payload.visibility === 'global'
        ) {
          const refreshedBindings = await refetchActiveBindings()
          if (Array.isArray(refreshedBindings)) {
            setPendingVisibilityChange({ payload, bindings: refreshedBindings })
            return
          }
        }
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
    [createPrompt, promptDialogPrompt, refetchActiveBindings, t, updatePrompt]
  )

  const handleConfirmVisibilityChange = useCallback(async () => {
    if (!pendingVisibilityChange) return

    setSavingPrompt(true)
    try {
      await updatePrompt({
        ...pendingVisibilityChange.payload,
        expectedBindings: pendingVisibilityChange.bindings
      })
      setPendingVisibilityChange(null)
      setPromptDialog(null)
    } catch (err) {
      if (err instanceof DataApiError && err.code === ErrorCode.CONCURRENT_MODIFICATION) {
        const refreshedBindings = await refetchActiveBindings()
        if (Array.isArray(refreshedBindings)) {
          setPendingVisibilityChange((current) => (current ? { ...current, bindings: refreshedBindings } : current))
        }
      }
      toast.error(formatErrorMessageWithPrefix(err, t('settings.prompts.errors.updateFailed')))
      throw err
    } finally {
      setSavingPrompt(false)
    }
  }, [pendingVisibilityChange, refetchActiveBindings, t, updatePrompt])

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
  const handleRetryBindingData = useCallback(() => {
    void refetchAllBindings()
    refetchAssistants()
    refetchAgents()
  }, [refetchAgents, refetchAllBindings, refetchAssistants])

  return (
    <SettingsContentBody className="min-h-0 flex-1 overflow-hidden pt-4" innerClassName="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <SettingTitle className="m-0 shrink-0">{t('settings.prompts.title')}</SettingTitle>
          <CollapsibleSearchBar
            value={search}
            onSearch={setSearch}
            placeholder={t('settings.prompts.searchPlaceholder')}
            tooltip={t('common.search')}
            clearLabel={t('common.clear')}
            maxWidth={220}
            collapsedSize={30}
            style={{ borderRadius: 8 }}
          />
        </div>
        <Button size="sm" onClick={() => setPromptDialog({ prompt: null })}>
          <Plus size={12} />
          {t('settings.prompts.add')}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
            title={normalizedSearch ? t('library.empty_state.no_match_title') : t('settings.prompts.noPrompts')}
            description={normalizedSearch ? t('library.empty_state.no_match_description') : undefined}
            className="py-14"
          />
        ) : (
          <Scrollbar className="min-h-0 flex-1 pb-3">
            <ReorderableList
              items={prompts}
              visibleItems={visiblePrompts}
              getId={(prompt) => prompt.id}
              onReorder={applyReorderedList}
              onReorderError={handleReorderError}
              disabled={savingPrompt || deletingPrompt || isReordering}
              dragHandle
              gap={8}
              restrictions={{ scrollableAncestor: true }}
              renderItem={(prompt, _index, state) => (
                <PromptRow
                  prompt={prompt}
                  bindings={bindingsByPrompt.get(prompt.id) ?? []}
                  bindingsError={bindingsError}
                  dragHandleProps={state.dragHandleProps}
                  isLoadingBindings={isLoadingAllBindings}
                  isLoadingTargets={isLoadingAssistants || isLoadingAgents}
                  onEdit={() => setPromptDialog({ prompt })}
                  onDelete={() => setDeleteTarget(prompt)}
                  onRetry={handleRetryBindingData}
                  targets={targetOptions}
                  targetsError={assistantsError ?? agentsError}
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
          count: pendingVisibilityChange?.bindings.length ?? 0
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
    <div className="space-y-2 pb-3" data-testid="prompt-settings-loading">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
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
  bindings,
  bindingsError,
  dragHandleProps,
  isLoadingBindings,
  isLoadingTargets,
  onDelete,
  onEdit,
  onRetry,
  prompt,
  targets,
  targetsError
}: {
  bindings: PromptBindingRelation[]
  bindingsError?: Error
  dragHandleProps?: SortableDragHandleProps
  isLoadingBindings: boolean
  isLoadingTargets: boolean
  onDelete: () => void
  onEdit: () => void
  onRetry: () => void
  prompt: Prompt
  targets: PromptTargetOption[]
  targetsError?: Error
}) {
  const { t } = useTranslation()
  const summary = getPromptSummary(prompt)

  return (
    <div className="group flex items-center gap-3 rounded-lg border border-border px-3 py-2 transition-[border-color] hover:border-border-strong">
      <Button
        ref={dragHandleProps?.ref}
        type="button"
        variant="ghost"
        size="icon-sm"
        {...dragHandleProps?.attributes}
        {...dragHandleProps?.listeners}
        aria-label={t('settings.prompts.reorder', { title: prompt.title })}
        onClick={(event) => event.stopPropagation()}
        className="shrink-0 cursor-grab text-foreground-tertiary active:cursor-grabbing">
        <GripVertical size={14} />
      </Button>
      <Button
        variant="ghost"
        aria-label={`${t('common.edit')} ${prompt.title}`}
        onClick={onEdit}
        className="h-auto min-w-0 flex-1 justify-start whitespace-normal rounded-md p-0 text-left hover:bg-transparent">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-foreground text-sm leading-5">{prompt.title}</span>
          <span className="mt-0.5 block truncate text-muted-foreground text-xs leading-5">{summary}</span>
        </span>
      </Button>
      {prompt.visibility === 'global' ? (
        <Badge variant="secondary" className="border-0 font-normal text-muted-foreground">
          {t('settings.prompts.visibility.global.badge')}
        </Badge>
      ) : null}
      {prompt.visibility === 'restricted' ? (
        <PromptTargetPopover
          bindings={bindings}
          bindingsError={bindingsError}
          isLoadingBindings={isLoadingBindings}
          isLoadingTargets={isLoadingTargets}
          onRetry={onRetry}
          prompt={prompt}
          targets={targets}
          targetsError={targetsError}
        />
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`${t('common.more')} ${prompt.title}`}>
            <MoreHorizontal size={13} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem
              variant="destructive"
              aria-label={`${t('common.delete')} ${prompt.title}`}
              onSelect={onDelete}>
              <Trash2 />
              {t('common.delete')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
