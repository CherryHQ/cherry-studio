import { InfoCircleOutlined } from '@ant-design/icons'
import { Button, ButtonGroup, InfoTooltip, RowFlex, Switch } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAssistants, useDefaultAssistant, useDefaultModel } from '@renderer/hooks/useAssistant'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setQuickAssistantId } from '@renderer/store/llm'
import { matchKeywordsInString } from '@renderer/utils'
import { cn } from '@renderer/utils/style'
import HomeWindow from '@renderer/windows/quickAssistant/home/HomeWindow'
import { Select } from 'antd'
import type React from 'react'
import type { FC } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '.'

const QuickAssistantSettings: FC = () => {
  const [enableQuickAssistant, setEnableQuickAssistant] = usePreference('feature.quick_assistant.enabled')
  const [clickTrayToShowQuickAssistant, setClickTrayToShowQuickAssistant] = usePreference(
    'feature.quick_assistant.click_tray_to_show'
  )
  const [readClipboardAtStartup, setReadClipboardAtStartup] = usePreference(
    'feature.quick_assistant.read_clipboard_at_startup'
  )
  const [, setTray] = usePreference('app.tray.enabled')

  const { t } = useTranslation()
  const { theme } = useTheme()
  const dispatch = useAppDispatch()
  const { assistants } = useAssistants()
  const { quickAssistantId } = useAppSelector((state) => state.llm)
  const { defaultAssistant: _defaultAssistant } = useDefaultAssistant()
  const { defaultModel } = useDefaultModel()

  // Take the "default assistant" from the assistant list first.
  const defaultAssistant = useMemo(
    () => assistants.find((a) => a.id === _defaultAssistant.id) || _defaultAssistant,
    [assistants, _defaultAssistant]
  )

  const handleEnableQuickAssistant = async (enable: boolean) => {
    await setEnableQuickAssistant(enable)

    void (!enable && window.api.quickAssistant.close())

    if (enable && !clickTrayToShowQuickAssistant) {
      window.toast.info({
        title: t('settings.quickAssistant.use_shortcut_to_show'),
        timeout: 4000,
        icon: <InfoCircleOutlined />
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
    <SettingContainer theme={theme}>
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
          <RowFlex className="items-center justify-between">
            <RowFlex className="items-center gap-2.5">
              {t('settings.models.quick_assistant_model')}
              <InfoTooltip
                content={t('selection.settings.user_modal.model.tooltip')}
                showArrow
                iconProps={{ className: 'cursor-pointer' }}
              />
              <Spacer />
            </RowFlex>
            <RowFlex className="items-center gap-2.5">
              {!quickAssistantId ? null : (
                <RowFlex className="items-center">
                  <Select
                    value={quickAssistantId || defaultAssistant.id}
                    style={{ width: 300, height: 34 }}
                    onChange={(value) => dispatch(setQuickAssistantId(value))}
                    placeholder={t('settings.models.quick_assistant_selection')}
                    showSearch
                    options={[
                      {
                        key: defaultAssistant.id,
                        value: defaultAssistant.id,
                        title: defaultAssistant.name,
                        label: (
                          <AssistantItem>
                            <ModelAvatar model={defaultAssistant.model || defaultModel} size={18} />
                            <AssistantName>{defaultAssistant.name}</AssistantName>
                            <Spacer />
                            <DefaultTag isCurrent={true}>{t('settings.models.quick_assistant_default_tag')}</DefaultTag>
                          </AssistantItem>
                        )
                      },
                      ...assistants
                        .filter((a) => a.id !== defaultAssistant.id)
                        .map((a) => ({
                          key: a.id,
                          value: a.id,
                          title: a.name,
                          label: (
                            <AssistantItem>
                              <ModelAvatar model={a.model || defaultModel} size={18} />
                              <AssistantName>{a.name}</AssistantName>
                              <Spacer />
                            </AssistantItem>
                          )
                        }))
                    ]}
                    filterOption={(input, option) => matchKeywordsInString(input, option?.title || '')}
                  />
                </RowFlex>
              )}
              <ButtonGroup>
                <Button
                  className="min-w-20"
                  variant={quickAssistantId ? 'default' : 'outline'}
                  onClick={() => {
                    dispatch(setQuickAssistantId(defaultAssistant.id))
                  }}>
                  {t('settings.models.use_assistant')}
                </Button>
                <Button
                  className="min-w-20"
                  variant={!quickAssistantId ? 'default' : 'outline'}
                  onClick={() => dispatch(setQuickAssistantId(''))}>
                  {t('settings.models.use_model')}
                </Button>
              </ButtonGroup>
            </RowFlex>
          </RowFlex>
        </SettingGroup>
      )}
      {enableQuickAssistant && (
        <div className="mx-auto h-[460px] w-full overflow-hidden rounded-[10px] border-[0.5px] border-border bg-background">
          <HomeWindow draggable={false} />
        </div>
      )}
    </SettingContainer>
  )
}

const AssistantItem = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex h-7 flex-row items-center gap-2', className)} {...props} />
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
