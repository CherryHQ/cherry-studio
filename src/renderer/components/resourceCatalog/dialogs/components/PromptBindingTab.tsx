import { Alert, Button, ReorderableList } from '@cherrystudio/ui'
import { useDataChange, useQuery } from '@data/hooks/useDataApi'
import { useReorder } from '@data/hooks/useReorder'
import { usePromptBindingMutations } from '@renderer/hooks/resourceCatalog'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { PromptBindingTarget } from '@shared/data/types/prompt'
import { GripVertical, MessageSquareText, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AddCatalogPopover, CatalogEmptyPlaceholder } from './CatalogPicker'

export type PromptBindingTabProps = {
  enabled: boolean
  target: PromptBindingTarget
  portalContainer?: HTMLElement | null
}

export function PromptBindingTab({ enabled, target, portalContainer }: PromptBindingTabProps) {
  const { t } = useTranslation()
  const [isBinding, setIsBinding] = useState(false)
  const isBindingRef = useRef(false)
  const {
    data: allPromptsData,
    error: allPromptsError,
    isLoading: isAllPromptsLoading,
    refetch: refetchAllPrompts
  } = useQuery('/prompts', { enabled, query: { visibility: 'restricted' } })
  const bindingParams =
    target.type === 'assistant'
      ? { targetType: 'assistant' as const, targetId: target.id }
      : { targetType: 'agent' as const, targetId: target.id }
  const {
    data: boundPromptsData,
    error: boundPromptsError,
    isLoading: isBoundPromptsLoading,
    refetch: refetchBoundPrompts
  } = useQuery('/prompt-bindings/:targetType/:targetId', {
    enabled,
    params: bindingParams
  })
  const { bindPrompt, unbindPrompt } = usePromptBindingMutations(target)
  const { applyReorderedList, isPending: isReordering } = useReorder('/prompt-bindings/:targetType/:targetId', {
    params: bindingParams
  })
  useDataChange('/prompts', () => {
    if (enabled) void refetchAllPrompts()
  })
  useDataChange('/prompt-bindings/:targetType/:targetId', () => {
    if (enabled) void refetchBoundPrompts()
  })

  useEffect(() => {
    isBindingRef.current = false
    setIsBinding(false)
  }, [target.id, target.type])

  const boundPromptIds = useMemo(() => new Set((boundPromptsData ?? []).map((prompt) => prompt.id)), [boundPromptsData])
  const promptItems = useMemo(() => {
    return (allPromptsData ?? []).map((prompt) => ({
      id: prompt.id,
      name: prompt.title,
      description: prompt.content.replace(/\s+/g, ' ').trim()
    }))
  }, [allPromptsData])

  const handleBindingChange = useCallback(
    async (promptId: string, shouldBind: boolean) => {
      if (isBindingRef.current) return

      isBindingRef.current = true
      setIsBinding(true)
      try {
        if (shouldBind) {
          await bindPrompt(promptId)
        } else {
          await unbindPrompt(promptId)
        }
      } catch (error) {
        toast.error(
          formatErrorMessageWithPrefix(
            error,
            t(shouldBind ? 'settings.prompts.errors.bindFailed' : 'settings.prompts.errors.unbindFailed')
          )
        )
      } finally {
        isBindingRef.current = false
        setIsBinding(false)
      }
    },
    [bindPrompt, t, unbindPrompt]
  )

  const error = allPromptsError ?? boundPromptsError
  const isLoading = isAllPromptsLoading || isBoundPromptsLoading
  const targetLabel = t(
    target.type === 'assistant' ? 'settings.prompts.binding.currentAssistant' : 'settings.prompts.binding.currentAgent'
  )
  const handleReorderError = useCallback(
    (reorderError: unknown) => {
      toast.error(formatErrorMessageWithPrefix(reorderError, t('settings.prompts.errors.reorderFailed')))
    },
    [t]
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {t('settings.prompts.binding.editDescription', { target: targetLabel })}
        </p>
        <AddCatalogPopover
          items={promptItems}
          enabledIds={boundPromptIds}
          onAdd={(promptId) => void handleBindingChange(promptId, true)}
          triggerLabel={t('settings.prompts.binding.add')}
          searchPlaceholder={t('settings.prompts.binding.search')}
          emptyLabel={t('settings.prompts.binding.noMore')}
          disabled={Boolean(error) || isLoading || isBinding}
          align="end"
          triggerPosition="end"
          triggerClassName="shrink-0 border border-border bg-transparent"
          portalContainer={portalContainer}
        />
      </div>

      {error ? (
        <Alert
          type="error"
          showIcon
          message={t('settings.prompts.errors.loadFailed')}
          description={error.message}
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => void Promise.all([refetchAllPrompts(), refetchBoundPrompts()])}>
              {t('common.retry')}
            </Button>
          }
          className="rounded-md px-4 py-3 shadow-none"
        />
      ) : isLoading ? (
        <CatalogEmptyPlaceholder>{t('common.loading')}</CatalogEmptyPlaceholder>
      ) : (boundPromptsData ?? []).length === 0 ? (
        <div className="flex flex-col items-center rounded-md border border-border-subtle border-dashed p-6">
          <MessageSquareText size={20} strokeWidth={1.2} className="mb-2 text-foreground-tertiary" />
          <p className="text-foreground-tertiary text-xs">{t('settings.prompts.binding.noLinked')}</p>
        </div>
      ) : (
        <ReorderableList
          items={boundPromptsData ?? []}
          getId={(prompt) => prompt.id}
          onReorder={applyReorderedList}
          onReorderError={handleReorderError}
          disabled={isBinding || isReordering}
          dragHandle
          gap={0}
          className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle"
          restrictions={{ scrollableAncestor: true }}
          renderItem={(prompt, _index, state) => (
            <div className="group flex min-w-0 items-center gap-2 px-3 py-2">
              <button
                ref={state.dragHandleProps?.ref}
                type="button"
                {...state.dragHandleProps?.attributes}
                {...state.dragHandleProps?.listeners}
                aria-label={t('settings.prompts.reorder', { title: prompt.title })}
                className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded-md text-foreground-tertiary hover:bg-accent/50 hover:text-foreground active:cursor-grabbing">
                <GripVertical size={12} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px]" title={prompt.title}>
                  {prompt.title}
                </div>
                {prompt.content ? (
                  <div
                    className="mt-0.5 truncate text-muted-foreground text-xs"
                    title={prompt.content.replace(/\s+/g, ' ').trim()}>
                    {prompt.content.replace(/\s+/g, ' ').trim()}
                  </div>
                ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={isBinding || isReordering}
                onClick={() => void handleBindingChange(prompt.id, false)}
                aria-label={t('settings.prompts.binding.remove')}
                className="flex h-6 min-h-0 w-6 shrink-0 items-center justify-center rounded-md font-normal text-muted-foreground opacity-0 shadow-none transition-all hover:bg-destructive hover:text-destructive-foreground focus-visible:opacity-100 focus-visible:ring-0 group-hover:opacity-100">
                <Trash2 size={10} />
              </Button>
            </div>
          )}
        />
      )}
    </div>
  )
}
