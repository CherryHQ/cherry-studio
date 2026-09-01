import { useNavigate } from '@tanstack/react-router'
import { Check, ChevronDown, Info } from 'lucide-react'
import type React from 'react'
import type { FC } from 'react'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  InfoTooltip,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RowFlex,
  SegmentedControl,
  Switch
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { ModelSettingsNavigation } from '@renderer/components/ModelSettingsNavigation'
import {
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingsContentColumn,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useDefaultModel } from '@renderer/hooks/useModel'
import { useTheme } from '@renderer/hooks/useTheme'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { Assistant } from '@renderer/types/assistant'
import { cn } from '@renderer/utils/style'
import HomeWindow from '@renderer/windows/quickAssistant/home/HomeWindow'
import type { Model } from '@shared/data/types/model'

const QuickAssistantSettings: FC = () => {
  const [enableQuickAssistant, setEnableQuickAssistant] = usePreference('feature.quick_assistant.enabled')
  const [clickTrayToShowQuickAssistant, setClickTrayToShowQuickAssistant] = usePreference(
    'feature.quick_assistant.click_tray_to_show'
  )
  const [readClipboardAtStartup, setReadClipboardAtStartup] = usePreference(
    'feature.quick_assistant.read_clipboard_at_startup'
  )
  const [, setTray] = usePreference('app.tray.enabled')
  const [quickAssistantId, setQuickAssistantId] = usePreference('feature.quick_assistant.assistant_id')

  const { t } = useTranslation()
  const { theme } = useTheme()
  const { assistants, hasLoaded: haveAssistantsLoaded } = useAssistants()
  const { defaultModel } = useDefaultModel()
  const navigate = useNavigate()
  const [assistantSelectOpen, setAssistantSelectOpen] = useState(false)
  const usageMethodTitleId = useId()
  const configurationTitleId = useId()

  const assistantOptions = assistants
  const firstAssistantId = assistantOptions[0]?.id
  const selectedAssistant = assistantOptions.find((assistant) => assistant.id === quickAssistantId)
  const isAssistantMode = Boolean(quickAssistantId && (!haveAssistantsLoaded || selectedAssistant))

  useEffect(() => {
    if (haveAssistantsLoaded && quickAssistantId && !selectedAssistant) {
      void setQuickAssistantId('')
    }
  }, [haveAssistantsLoaded, quickAssistantId, selectedAssistant, setQuickAssistantId])

  const handleAssistantSelect = (assistantId: string) => {
    void setQuickAssistantId(assistantId)
    setAssistantSelectOpen(false)
  }

  const handleEnableQuickAssistant = async (enable: boolean) => {
    await setEnableQuickAssistant(enable)

    void (!enable && ipcApi.request('quick_assistant.close'))

    if (enable && !clickTrayToShowQuickAssistant) {
      toast.info({
        title: t('settings.quickAssistant.use_shortcut_to_show'),
        timeout: 4000,
        icon: <Info size={16} />
      })
    }

    if (enable && clickTrayToShowQuickAssistant) {
      void setTray(true)
    }
  }

  const handleClickTrayToShowQuickAssistant = async (checked: boolean) => {
    await setClickTrayToShowQuickAssistant(checked)
    if (checked) void setTray(true)
  }

  const handleClickReadClipboardAtStartup = async (checked: boolean) => {
    await setReadClipboardAtStartup(checked)
    void ipcApi.request('quick_assistant.close')
  }

  return (
    <SettingsContentColumn theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.quickAssistant.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>{t('settings.quickAssistant.enable_quick_assistant')}</span>
            <InfoTooltip
              content={t('settings.quickAssistant.use_shortcut_to_show')}
              placement="right"
              iconProps={{ className: 'cursor-pointer' }}
            />
          </SettingRowTitle>
          <Switch checked={enableQuickAssistant} onCheckedChange={handleEnableQuickAssistant} />
        </SettingRow>
        {enableQuickAssistant && (
          <>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.quickAssistant.click_tray_to_show')}</SettingRowTitle>
              <Switch checked={clickTrayToShowQuickAssistant} onCheckedChange={handleClickTrayToShowQuickAssistant} />
            </SettingRow>
          </>
        )}
        {enableQuickAssistant && (
          <>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.quickAssistant.read_clipboard_at_startup')}</SettingRowTitle>
              <Switch checked={readClipboardAtStartup} onCheckedChange={handleClickReadClipboardAtStartup} />
            </SettingRow>
          </>
        )}
      </SettingGroup>
      {enableQuickAssistant && (
        <SettingGroup theme={theme}>
          <SettingTitle>{t('settings.models.quick_assistant_response_settings')}</SettingTitle>
          <SettingDivider />
          <SettingRow role="group" aria-labelledby={usageMethodTitleId} className="min-h-8.5 gap-3">
            <SettingRowTitle id={usageMethodTitleId}>
              {t('settings.models.quick_assistant_usage_method')}
            </SettingRowTitle>
            <SegmentedControl<'assistant' | 'model'>
              aria-label={t('settings.models.quick_assistant_usage_method')}
              size="sm"
              value={isAssistantMode ? 'assistant' : 'model'}
              options={[
                {
                  value: 'assistant',
                  label: t('settings.models.use_assistant'),
                  disabled: assistantOptions.length === 0
                },
                { value: 'model', label: t('settings.models.use_model') }
              ]}
              onValueChange={(value) => void setQuickAssistantId(value === 'assistant' ? (firstAssistantId ?? '') : '')}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow role="group" aria-labelledby={configurationTitleId} className="min-h-8.5 flex-nowrap gap-3">
            <SettingRowTitle id={configurationTitleId} className={isAssistantMode ? 'gap-2.5' : undefined}>
              {t(
                isAssistantMode
                  ? 'settings.models.quick_assistant_selection'
                  : 'settings.models.default_assistant_model'
              )}
              {isAssistantMode && (
                <InfoTooltip
                  content={t('selection.settings.user_modal.model.tooltip')}
                  showArrow
                  iconProps={{ className: 'cursor-pointer' }}
                />
              )}
            </SettingRowTitle>
            {isAssistantMode ? (
              selectedAssistant ? (
                <RowFlex className="items-center">
                  <Popover open={assistantSelectOpen} onOpenChange={setAssistantSelectOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="h-8.5 w-75 justify-between px-2 shadow-none"
                        aria-expanded={assistantSelectOpen}>
                        <AssistantOption
                          assistant={selectedAssistant}
                          firstAssistantId={firstAssistantId}
                          defaultModel={defaultModel}
                        />
                        <ChevronDown size={16} className="shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-75 p-0"
                      align="end"
                      onFocusOutside={(event) => {
                        // The embedded quick assistant preview auto-focuses its input on render.
                        event.preventDefault()
                      }}>
                      <Command>
                        <CommandInput placeholder={t('settings.models.quick_assistant_selection')} />
                        <CommandList>
                          <CommandEmpty>{t('common.no_results')}</CommandEmpty>
                          <CommandGroup>
                            {assistantOptions.map((assistant) => (
                              <CommandItem
                                key={assistant.id}
                                value={`${assistant.name} ${assistant.id}`}
                                keywords={[assistant.name, assistant.id]}
                                onSelect={() => {
                                  handleAssistantSelect(assistant.id)
                                }}>
                                <AssistantOption
                                  assistant={assistant}
                                  firstAssistantId={firstAssistantId}
                                  defaultModel={defaultModel}
                                />
                                {assistant.id === quickAssistantId && (
                                  <Check size={14} className="ml-auto text-primary" />
                                )}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </RowFlex>
              ) : null
            ) : (
              <ModelSettingsNavigation
                model={defaultModel}
                onNavigate={() => void navigate({ to: '/settings/model', search: { focus: 'default' } })}
              />
            )}
          </SettingRow>
        </SettingGroup>
      )}
      {enableQuickAssistant && (
        <div className="mx-auto mt-5 h-115 w-full overflow-hidden rounded-[10px] border-[0.5px] border-border bg-background">
          <HomeWindow draggable={false} />
        </div>
      )}
    </SettingsContentColumn>
  )
}

const AssistantOption = ({
  assistant,
  firstAssistantId,
  defaultModel
}: {
  assistant: Assistant
  firstAssistantId?: string
  defaultModel: Model | undefined
}) => {
  const { t } = useTranslation()
  const isDefault = !!firstAssistantId && assistant.id === firstAssistantId

  return (
    <AssistantItem>
      <ModelAvatar model={defaultModel} size={18} />
      <AssistantName>{assistant.name}</AssistantName>
      <Spacer />
      {isDefault && <DefaultTag isCurrent={true}>{t('settings.models.quick_assistant_default_tag')}</DefaultTag>}
    </AssistantItem>
  )
}

const AssistantItem = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex h-7 min-w-0 flex-1 flex-row items-center gap-2', className)} {...props} />
)

const AssistantName = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span className={cn('max-w-[calc(100%-60px)] truncate', className)} {...props} />
)

const Spacer = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex-1', className)} {...props} />
)

const DefaultTag = ({
  className,
  isCurrent,
  ...props
}: React.ComponentPropsWithoutRef<'span'> & { isCurrent: boolean }) => (
  <span
    className={cn('rounded px-1 py-0.5 text-xs', isCurrent ? 'text-primary' : 'text-foreground-tertiary', className)}
    {...props}
  />
)

export default QuickAssistantSettings
