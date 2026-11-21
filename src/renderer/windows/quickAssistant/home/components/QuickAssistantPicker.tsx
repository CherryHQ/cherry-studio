import { Check, ChevronDown, UserRound } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@cherrystudio/ui'
import { AssistantAvatarImage } from '@renderer/components/Avatar/AssistantAvatarImage'
import { useAssistantsApi } from '@renderer/hooks/useAssistant'
import type { Assistant } from '@shared/data/types/assistant'

function AssistantIdentity({ assistant, fallback }: { assistant?: Assistant; fallback?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <AssistantAvatarImage
        src={assistant?.avatarSrc}
        alt=""
        size={20}
        className="size-5 shrink-0 rounded object-cover"
        fallback={
          assistant?.emoji ? (
            <span aria-hidden className="flex size-5 shrink-0 items-center justify-center text-base">
              {assistant.emoji}
            </span>
          ) : (
            <UserRound size={18} className="shrink-0" />
          )
        }
      />
      <span className="truncate">{assistant?.name ?? fallback}</span>
    </span>
  )
}

/** Inline only: no Settings navigation, creation dialog or persistent chat history. */
export default function QuickAssistantPicker({
  assistant,
  modelName,
  disabled,
  onSelect
}: {
  assistant?: Assistant
  modelName?: string
  disabled?: boolean
  onSelect: (id: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const { assistants, hasLoaded, error: loadError, refetch } = useAssistantsApi({ enabled: open })
  const modelLabel = t('settings.models.use_model')
  const label = t('settings.models.quick_assistant_selection')
  const select = async (id: string) => {
    if (saving) return
    setSaving(true)
    setError(false)
    try {
      await onSelect(id)
      setOpen(false)
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="nodrag mb-1 min-w-0">
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (!saving) {
            setOpen(next)
            if (next) setSearch('')
            setError(false)
          }
        }}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled || saving}
            aria-label={label}
            aria-expanded={open}
            className="h-8 max-w-full gap-2 px-2">
            <AssistantIdentity assistant={assistant} fallback={modelName ? `${modelLabel}: ${modelName}` : label} />
            <ChevronDown size={14} className="shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={4}
          className="nodrag w-[min(20rem,calc(100vw-2rem))] p-0"
          onEscapeKeyDown={(event) => event.stopPropagation()}>
          <Command>
            <CommandInput
              aria-label={label}
              placeholder={label}
              disabled={saving}
              value={search}
              onValueChange={setSearch}
            />
            <CommandList className="max-h-56">
              {!hasLoaded && !loadError && (
                <div role="status" className="p-3 text-sm text-muted-foreground">
                  {t('common.loading')}
                </div>
              )}
              {loadError ? (
                <div role="alert" className="p-3 text-sm">
                  {t('common.error')}
                  <Button variant="ghost" size="sm" onClick={() => void refetch()}>
                    {t('common.retry')}
                  </Button>
                </div>
              ) : (
                <>
                  <CommandEmpty>{t('common.no_results')}</CommandEmpty>
                  <CommandGroup>
                    <CommandItem value={modelLabel} disabled={saving} onSelect={() => void select('')}>
                      <AssistantIdentity fallback={modelName ? `${modelLabel}: ${modelName}` : modelLabel} />
                      {!assistant && <Check size={14} className="ml-auto shrink-0" />}
                    </CommandItem>
                    {assistants.map((item) => (
                      <CommandItem
                        key={item.id}
                        value={`${item.name} ${item.id}`}
                        disabled={saving}
                        onSelect={() => void select(item.id)}>
                        <AssistantIdentity assistant={item} />
                        {item.id === assistant?.id && <Check size={14} className="ml-auto shrink-0" />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {error && (
        <div role="alert" className="px-2 text-xs text-error">
          {t('common.save_failed')}
        </div>
      )}
    </div>
  )
}
