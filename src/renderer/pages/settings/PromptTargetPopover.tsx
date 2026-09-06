import { Button, Combobox, type ComboboxOption, Skeleton } from '@cherrystudio/ui'
import { usePromptTargetMutations } from '@renderer/hooks/resourceCatalog'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { Prompt, PromptBindingRelation, PromptBindingTarget } from '@shared/data/types/prompt'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export type PromptTargetOption = ComboboxOption<{ target: PromptBindingTarget }>

export type PromptTargetPopoverProps = {
  bindings: PromptBindingRelation[]
  bindingsError?: Error
  isLoadingBindings: boolean
  isLoadingTargets: boolean
  onRetry: () => void | Promise<unknown>
  prompt: Prompt
  targets: PromptTargetOption[]
  targetsError?: Error
}

function getBindingTargetKey(binding: PromptBindingRelation) {
  return `${binding.targetType}:${binding.targetId}`
}

export function PromptTargetPopover({
  bindings,
  bindingsError,
  isLoadingBindings,
  isLoadingTargets,
  onRetry,
  prompt,
  targets,
  targetsError
}: PromptTargetPopoverProps) {
  const { t } = useTranslation()
  const [isMutating, setIsMutating] = useState(false)
  const isMutatingRef = useRef(false)
  const { bindTarget, unbindTarget } = usePromptTargetMutations(prompt.id)
  const boundTargetKeys = useMemo(() => new Set(bindings.map((binding) => getBindingTargetKey(binding))), [bindings])
  const selectedTargetKeys = useMemo(() => Array.from(boundTargetKeys), [boundTargetKeys])
  const availableTargets = useMemo(
    () => (isMutating ? targets.map((target) => ({ ...target, disabled: true })) : targets),
    [isMutating, targets]
  )
  const error = bindingsError ?? targetsError

  const handleToggle = async (target: PromptTargetOption) => {
    if (isMutatingRef.current) return

    const targetKey = target.value
    const isBound = boundTargetKeys.has(targetKey)
    isMutatingRef.current = true
    setIsMutating(true)
    try {
      if (isBound) await unbindTarget(target.target)
      else await bindTarget(target.target)
    } catch (mutationError) {
      toast.error(
        formatErrorMessageWithPrefix(
          mutationError,
          t(isBound ? 'settings.prompts.errors.unbindFailed' : 'settings.prompts.errors.bindFailed')
        )
      )
    } finally {
      isMutatingRef.current = false
      setIsMutating(false)
    }
  }

  const handleValueChange = (value: string | string[]) => {
    if (!Array.isArray(value)) return

    const nextTargetKeys = new Set(value)
    const changedTarget = targets.find(
      (target) => nextTargetKeys.has(target.value) !== boundTargetKeys.has(target.value)
    )
    if (changedTarget) void handleToggle(changedTarget)
  }

  if (error) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={t('settings.prompts.binding.manageTargets', { title: prompt.title })}
        onClick={() => void onRetry()}>
        {t('common.retry')}
      </Button>
    )
  }

  return (
    <Combobox
      multiple
      size="sm"
      options={availableTargets}
      value={selectedTargetKeys}
      onChange={handleValueChange}
      disabled={isLoadingBindings || isLoadingTargets || isMutating}
      aria-label={t('settings.prompts.binding.manageTargets', { title: prompt.title })}
      searchPlaceholder={t('settings.prompts.binding.searchTargets')}
      emptyText={targets.length === 0 ? t('settings.prompts.binding.noTargets') : t('common.no_results')}
      popoverAlign="end"
      popoverClassName="w-80 max-w-[calc(100vw-2rem)]"
      className="min-w-0 max-w-52"
      renderValue={(_value, options) => {
        if (isLoadingBindings || isLoadingTargets) return <Skeleton className="h-4 w-14 rounded-full" />

        const firstBoundTarget = options.find((target) => boundTargetKeys.has(target.value))
        if (!firstBoundTarget) {
          return bindings.length > 0
            ? t('settings.prompts.binding.targetCount', { count: bindings.length })
            : t('settings.prompts.binding.unassigned')
        }

        return (
          <>
            {firstBoundTarget.icon}
            <span className="truncate">{firstBoundTarget.label}</span>
            {bindings.length > 1 ? <span className="shrink-0">+{bindings.length - 1}</span> : null}
          </>
        )
      }}
    />
  )
}
