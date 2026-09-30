import { Settings2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Scrollbar,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Switch
} from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { LocalAgentConfigOption } from '@shared/ai/localAgent'

export function LocalAgentConfigControl({
  sessionId,
  options,
  disabled
}: {
  sessionId: string
  options: LocalAgentConfigOption[]
  disabled: boolean
}) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  if (!options.length) return null
  const change = async (configId: string, value: string | boolean) => {
    if (disabled || saving) return
    setSaving(true)
    try {
      await ipcApi.request('ai.local_agents.set_config_option', { sessionId, configId, value })
    } catch (error) {
      toast.error(String(error))
    } finally {
      setSaving(false)
    }
  }
  const renderChoice = (option: { value: string; name: string; description?: string | null }) => (
    <SelectItem
      key={option.value}
      value={option.value}
      textValue={option.name}
      className="py-2 not-last:mb-1 data-[state=checked]:bg-accent! data-[state=checked]:text-accent-foreground! [&_.lucide-check]:text-muted-foreground!">
      <div>
        <div>{option.name}</div>
        {option.description && (
          <div className="mt-0.5 whitespace-normal text-xs text-muted-foreground">{option.description}</div>
        )}
      </div>
    </SelectItem>
  )
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={t('common.settings')}>
          <Settings2 className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-80 p-3">
        <Scrollbar className="max-h-80 space-y-4">
          {options.map((option) => (
            <div key={option.id} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium">{option.name}</span>
                {option.type === 'boolean' && (
                  <Switch
                    aria-label={option.name}
                    checked={option.currentValue}
                    disabled={disabled || saving}
                    onCheckedChange={(value) => void change(option.id, value)}
                  />
                )}
              </div>
              {option.description && <p className="text-xs text-muted-foreground">{option.description}</p>}
              {option.type === 'select' && (
                <Select
                  value={option.currentValue}
                  disabled={disabled || saving}
                  onValueChange={(value) => void change(option.id, value)}>
                  <SelectTrigger aria-label={option.name} className="h-8 w-full text-xs">
                    <SelectValue>
                      {option.options
                        .flatMap((choice) => ('group' in choice ? choice.options : [choice]))
                        .find((choice) => choice.value === option.currentValue)?.name ?? option.currentValue}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="max-w-80">
                    {option.options.map((choice) =>
                      'group' in choice ? (
                        <SelectGroup key={choice.group}>
                          <SelectLabel>{choice.name}</SelectLabel>
                          {choice.options.map(renderChoice)}
                        </SelectGroup>
                      ) : (
                        renderChoice(choice)
                      )
                    )}
                  </SelectContent>
                </Select>
              )}
            </div>
          ))}
        </Scrollbar>
      </PopoverContent>
    </Popover>
  )
}
