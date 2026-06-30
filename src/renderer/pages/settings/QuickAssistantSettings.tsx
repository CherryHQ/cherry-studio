import { Combobox, InfoTooltip, RowFlex, SegmentedControl, Switch } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useDefaultModel } from '@renderer/hooks/useModel'
import { useTheme } from '@renderer/hooks/useTheme'
import type { Assistant } from '@renderer/types/assistant'
import { cn } from '@renderer/utils/style'
import HomeWindow from '@renderer/windows/quickAssistant/home/HomeWindow'
import type { Model } from '@shared/data/types/model'
import { Info, PictureInPicture2 } from 'lucide-react'
import type React from 'react'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingCard, SettingGroup, SettingRow, SettingRowTitle, SettingsContentColumn, SettingsPageHeader } from '.'

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
  const { assistants } = useAssistants()
  const { defaultModel } = useDefaultModel()
  const [assistantSelectOpen, setAssistantSelectOpen] = useState(false)

  const assistantOptions = assistants
  const firstAssistantId = assistantOptions[0]?.id
  const selectedAssistant = assistantOptions.find((assistant) => assistant.id === quickAssistantId)
  const handleAssistantSelect = (assistantId: string) => {
    void setQuickAssistantId(assistantId)
  }

  const handleEnableQuickAssistant = async (enable: boolean) => {
    await setEnableQuickAssistant(enable)

    void (!enable && window.api.quickAssistant.close())

    if (enable && !clickTrayToShowQuickAssistant) {
      window.toast.info({
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
    void window.api.quickAssistant.close()
  }

  return (
    <SettingsContentColumn theme={theme}>
      <SettingGroup theme={theme}>
        <SettingsPageHeader
          icon={<PictureInPicture2 />}
          title={t('settings.quickAssistant.title')}
          description={t('settings.quickAssistant.description')}
        />
        <SettingCard>
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
            <SettingRow>
              <SettingRowTitle>{t('settings.quickAssistant.click_tray_to_show')}</SettingRowTitle>
              <Switch checked={clickTrayToShowQuickAssistant} onCheckedChange={handleClickTrayToShowQuickAssistant} />
            </SettingRow>
          )}
          {enableQuickAssistant && (
            <SettingRow>
              <SettingRowTitle>{t('settings.quickAssistant.read_clipboard_at_startup')}</SettingRowTitle>
              <Switch checked={readClipboardAtStartup} onCheckedChange={handleClickReadClipboardAtStartup} />
            </SettingRow>
          )}
        </SettingCard>
      </SettingGroup>
      {enableQuickAssistant && (
        <SettingGroup theme={theme}>
          <SettingRow className="min-h-8.5 flex-nowrap gap-3">
            <SettingRowTitle className="gap-2.5">
              {t('settings.models.quick_assistant_model')}
              <InfoTooltip
                content={t('selection.settings.user_modal.model.tooltip')}
                showArrow
                iconProps={{ className: 'cursor-pointer' }}
              />
            </SettingRowTitle>
            <RowFlex className="items-center gap-2.5">
              {!quickAssistantId || !selectedAssistant ? null : (
                <RowFlex className="items-center">
                  <Combobox<{ assistant: Assistant }>
                    open={assistantSelectOpen}
                    onOpenChange={setAssistantSelectOpen}
                    width={300}
                    className="h-8.5"
                    value={quickAssistantId}
                    onChange={(value) => handleAssistantSelect(value as string)}
                    options={assistantOptions.map((assistant) => ({
                      value: assistant.id,
                      label: assistant.name,
                      assistant
                    }))}
                    searchPlaceholder={t('settings.models.quick_assistant_selection')}
                    emptyText={t('common.no_results')}
                    filterOption={(option, search) =>
                      `${option.label} ${option.value}`.toLowerCase().includes(search.trim().toLowerCase())
                    }
                    renderValue={(value, options) => {
                      const assistant = options.find((option) => option.value === value)?.assistant ?? selectedAssistant
                      return (
                        <AssistantOption
                          assistant={assistant}
                          firstAssistantId={firstAssistantId}
                          defaultModel={defaultModel}
                        />
                      )
                    }}
                    renderOption={(option) => (
                      <AssistantOption
                        assistant={option.assistant}
                        firstAssistantId={firstAssistantId}
                        defaultModel={defaultModel}
                      />
                    )}
                    onFocusOutside={(event) => {
                      // The embedded quick assistant preview auto-focuses its input on render;
                      // without this the dropdown closes immediately when it steals focus.
                      event.preventDefault()
                    }}
                  />
                </RowFlex>
              )}
              <SegmentedControl
                value={quickAssistantId ? 'assistant' : 'model'}
                onValueChange={(next) => {
                  if (next === 'assistant') {
                    void setQuickAssistantId(firstAssistantId ?? '')
                  } else {
                    void setQuickAssistantId('')
                  }
                }}
                options={[
                  { value: 'assistant', label: t('settings.models.use_assistant') },
                  { value: 'model', label: t('settings.models.use_model') }
                ]}
              />
            </RowFlex>
          </SettingRow>
        </SettingGroup>
      )}
      {enableQuickAssistant && (
        <div className="mx-auto mt-5 h-115 w-full overflow-hidden rounded-lg border-[0.5px] border-border bg-background">
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
    className={cn('rounded px-1 py-0.5 text-xs', isCurrent ? 'text-primary' : 'text-foreground-muted', className)}
    {...props}
  />
)

export default QuickAssistantSettings
