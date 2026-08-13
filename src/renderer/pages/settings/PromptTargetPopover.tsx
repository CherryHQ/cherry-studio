import {
  Badge,
  Button,
  Checkbox,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton
} from '@cherrystudio/ui'
import { usePromptTargetMutations } from '@renderer/hooks/resourceCatalog'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { Prompt, PromptBindingRelation, PromptBindingTarget } from '@shared/data/types/prompt'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export type PromptTargetOption = PromptBindingTarget & {
  avatar: string
  name: string
}

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

function getTargetKey(target: PromptBindingTarget) {
  return `${target.type}:${target.id}`
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
  const firstBoundTarget = targets.find((target) => boundTargetKeys.has(getTargetKey(target)))
  const error = bindingsError ?? targetsError

  const handleToggle = async (target: PromptTargetOption) => {
    if (isMutatingRef.current) return

    const targetKey = getTargetKey(target)
    const isBound = boundTargetKeys.has(targetKey)
    isMutatingRef.current = true
    setIsMutating(true)
    try {
      if (isBound) await unbindTarget(target)
      else await bindTarget(target)
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

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t('settings.prompts.binding.manageTargets', { title: prompt.title })}
          className="h-7 min-h-0 min-w-0 max-w-52 gap-1.5 rounded-md px-2 font-normal text-muted-foreground text-xs shadow-none hover:bg-accent/50 hover:text-foreground">
          {isLoadingBindings ? (
            <Skeleton className="h-4 w-14 rounded-full" />
          ) : error ? (
            <span>—</span>
          ) : firstBoundTarget ? (
            <>
              <span className="flex size-5 shrink-0 items-center justify-center rounded bg-secondary text-xs">
                {firstBoundTarget.avatar}
              </span>
              <span className="truncate">{firstBoundTarget.name}</span>
              {bindings.length > 1 ? <span className="shrink-0">+{bindings.length - 1}</span> : null}
            </>
          ) : bindings.length > 0 ? (
            t('settings.prompts.binding.targetCount', { count: bindings.length })
          ) : (
            t('settings.prompts.binding.unassigned')
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] rounded-md p-0">
        <div className="flex h-10 items-center justify-between gap-3 border-border-subtle border-b px-3">
          <span className="truncate font-medium text-foreground text-sm">{t('settings.prompts.binding.targets')}</span>
          {!isLoadingBindings && !error ? (
            <span className="shrink-0 text-muted-foreground text-xs tabular-nums">{bindings.length}</span>
          ) : null}
        </div>
        {error ? (
          <div className="flex min-h-32 flex-col items-center justify-center gap-2 px-4 text-center">
            <span className="text-muted-foreground text-xs">{t('settings.prompts.errors.loadBindingsFailed')}</span>
            <Button variant="outline" size="sm" onClick={() => void onRetry()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : isLoadingBindings || isLoadingTargets ? (
          <TargetListSkeleton />
        ) : (
          <Command>
            <CommandInput placeholder={t('settings.prompts.binding.searchTargets')} />
            <CommandList className="max-h-72">
              <CommandEmpty>
                {targets.length === 0 ? t('settings.prompts.binding.noTargets') : t('common.no_results')}
              </CommandEmpty>
              <CommandGroup>
                {targets.map((target) => {
                  const targetKey = getTargetKey(target)
                  const isBound = boundTargetKeys.has(targetKey)
                  return (
                    <CommandItem
                      key={targetKey}
                      value={`${target.name} ${target.type} ${target.id}`}
                      keywords={[target.name, target.type, target.id]}
                      disabled={isMutating}
                      onSelect={() => void handleToggle(target)}
                      className="gap-2 rounded-md">
                      <Checkbox checked={isBound} tabIndex={-1} aria-hidden className="pointer-events-none shrink-0" />
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary text-sm">
                        {target.avatar}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-foreground">{target.name}</span>
                      <span className="sr-only">{t(isBound ? 'common.enabled' : 'common.disabled')}</span>
                      {target.type === 'agent' ? (
                        <Badge variant="secondary" className="shrink-0 border-0 px-1.5 py-0 font-normal text-xs">
                          {t('common.agent')}
                        </Badge>
                      ) : null}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  )
}

function TargetListSkeleton() {
  return (
    <div className="space-y-2.5 p-3">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="flex items-center gap-2">
          <Skeleton className="size-4 rounded" />
          <Skeleton className="size-7 rounded-md" />
          <Skeleton className="h-3 flex-1" />
        </div>
      ))}
    </div>
  )
}
