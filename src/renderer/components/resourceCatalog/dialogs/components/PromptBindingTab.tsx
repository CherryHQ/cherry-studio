import { Alert, Button, Input } from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import { usePromptBindingMutations } from '@renderer/hooks/resourceCatalog'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { PromptBindingTarget } from '@shared/data/types/prompt'
import { Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CatalogToggleGrid } from './CatalogPicker'

export type PromptBindingTabProps = {
  enabled: boolean
  target: PromptBindingTarget
  portalContainer?: HTMLElement | null
}

export function PromptBindingTab({ enabled, target, portalContainer }: PromptBindingTabProps) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [isBinding, setIsBinding] = useState(false)
  const isBindingRef = useRef(false)
  const {
    data: allPromptsData,
    error: allPromptsError,
    isLoading: isAllPromptsLoading,
    refetch: refetchAllPrompts
  } = useQuery('/prompts', { enabled })
  const {
    data: boundPromptsData,
    error: boundPromptsError,
    isLoading: isBoundPromptsLoading,
    refetch: refetchBoundPrompts
  } = useQuery('/prompts', {
    enabled,
    query: {
      targetType: target.type,
      targetId: target.id
    }
  })
  const { bindPrompt, unbindPrompt } = usePromptBindingMutations()

  useEffect(() => {
    setSearch('')
    isBindingRef.current = false
    setIsBinding(false)
  }, [target.id, target.type])

  const boundPromptIds = useMemo(() => new Set((boundPromptsData ?? []).map((prompt) => prompt.id)), [boundPromptsData])
  const promptItems = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()
    return (allPromptsData ?? [])
      .filter(
        (prompt) =>
          !normalizedSearch ||
          prompt.title.toLowerCase().includes(normalizedSearch) ||
          prompt.content.toLowerCase().includes(normalizedSearch)
      )
      .map((prompt) => ({
        id: prompt.id,
        name: prompt.title,
        description: prompt.content.replace(/\s+/g, ' ').trim()
      }))
  }, [allPromptsData, search])

  const handleToggle = useCallback(
    async (promptId: string, shouldBind: boolean) => {
      if (isBindingRef.current) return

      isBindingRef.current = true
      setIsBinding(true)
      try {
        if (shouldBind) {
          await bindPrompt(promptId, target)
        } else {
          await unbindPrompt(promptId, target)
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
    [bindPrompt, t, target, unbindPrompt]
  )

  const error = allPromptsError ?? boundPromptsError
  const isLoading = isAllPromptsLoading || isBoundPromptsLoading
  const targetLabel = t(
    target.type === 'assistant' ? 'settings.prompts.binding.currentAssistant' : 'settings.prompts.binding.currentAgent'
  )

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        {t('settings.prompts.binding.editDescription', { target: targetLabel })}
      </p>

      <div className="relative">
        <Search size={14} className="-translate-y-1/2 absolute top-1/2 left-2.5 text-foreground-tertiary" />
        <Input
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
      ) : (
        <CatalogToggleGrid
          items={promptItems}
          enabledIds={boundPromptIds}
          onToggle={(promptId, shouldBind) => void handleToggle(promptId, shouldBind)}
          loading={isLoading}
          disabled={isBinding}
          emptyLabel={search.trim() ? t('library.empty_state.no_match_title') : t('settings.prompts.noPrompts')}
          portalContainer={portalContainer}
          layout="list"
        />
      )}
    </div>
  )
}
