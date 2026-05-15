import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EditableNumber,
  Flex,
  HelpTooltip,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RowFlex,
  Switch,
  Textarea,
  Tooltip
} from '@cherrystudio/ui'
import EmojiPicker from '@renderer/components/EmojiPicker'
import { ResetIcon } from '@renderer/components/Icons'
import Selector from '@renderer/components/Selector'
import { TopView } from '@renderer/components/TopView'
import { DEFAULT_TEMPERATURE } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useDefaultAssistant } from '@renderer/hooks/useAssistant'
import { DEFAULT_ASSISTANT_SETTINGS } from '@renderer/services/AssistantService'
import type { AssistantSettings as AssistantSettingsType } from '@renderer/types'
import { getLeadingEmoji, modalConfirm } from '@renderer/utils'
import { DEFAULT_ASSISTANT_CONTEXT_COUNT } from '@shared/data/preference/preferenceTypes'
import { CircleX } from 'lucide-react'
import type { Dispatch, FC, SetStateAction } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingRow, SettingSubtitle } from '..'
import ParameterSlider from './ParameterSlider'

const PARAMETER_ROW_CLASS = 'border-border/60 border-b py-4 last:border-b-0'
const PARAMETER_SLIDER_CLASS = 'mt-3 grid grid-cols-[minmax(0,1fr)_96px] items-center gap-4'
type AssistantSettingsWithContextCount = AssistantSettingsType & { contextCount?: number }

export const AssistantSettings: FC = () => {
  const { defaultAssistant, updateDefaultAssistant } = useDefaultAssistant()
  const defaultAssistantSettings = defaultAssistant.settings as AssistantSettingsWithContextCount
  const [temperature, setTemperature] = useState(defaultAssistantSettings.temperature ?? DEFAULT_TEMPERATURE)
  const [enableTemperature, setEnableTemperature] = useState(defaultAssistantSettings.enableTemperature ?? false)
  const [contextCount, setContextCount] = useState(
    defaultAssistantSettings.contextCount ?? DEFAULT_ASSISTANT_CONTEXT_COUNT
  )
  const [enableMaxTokens, setEnableMaxTokens] = useState(defaultAssistantSettings.enableMaxTokens ?? false)
  const [maxTokens, setMaxTokens] = useState(defaultAssistantSettings.maxTokens ?? DEFAULT_ASSISTANT_SETTINGS.maxTokens)
  const [topP, setTopP] = useState(defaultAssistantSettings.topP ?? 1)
  const [enableTopP, setEnableTopP] = useState(defaultAssistantSettings.enableTopP ?? false)
  const [toolUseMode, setToolUseMode] = useState<AssistantSettingsType['toolUseMode']>(
    defaultAssistantSettings.toolUseMode ?? 'function'
  )
  const [emoji, setEmoji] = useState(defaultAssistant.emoji || getLeadingEmoji(defaultAssistant.name) || '')
  const [name, setName] = useState(
    defaultAssistant.name.replace(getLeadingEmoji(defaultAssistant.name) || '', '').trim()
  )
  const { theme } = useTheme()

  const { t } = useTranslation()

  const onUpdateAssistantSettings = (settings: Partial<AssistantSettingsWithContextCount>) => {
    const nextSettings = {
      ...defaultAssistant.settings,
      temperature: settings.temperature ?? temperature,
      enableTemperature: settings.enableTemperature ?? enableTemperature,
      enableMaxTokens: settings.enableMaxTokens ?? enableMaxTokens,
      maxTokens: settings.maxTokens ?? maxTokens,
      streamOutput: settings.streamOutput ?? true,
      topP: settings.topP ?? topP,
      enableTopP: settings.enableTopP ?? enableTopP,
      toolUseMode: settings.toolUseMode ?? toolUseMode,
      contextCount: settings.contextCount ?? contextCount
    } as AssistantSettingsWithContextCount

    updateDefaultAssistant({
      ...defaultAssistant,
      settings: nextSettings
    })
  }

  const handleChange =
    (setter: Dispatch<SetStateAction<number>>, updater: (value: number) => void) => (value: number | null) => {
      if (value !== null) {
        setter(value)
        updater(value)
      }
    }
  const onTemperatureChange = handleChange(setTemperature, (value) => onUpdateAssistantSettings({ temperature: value }))
  const onContextCountChange = handleChange(setContextCount, (value) =>
    onUpdateAssistantSettings({ contextCount: value })
  )
  const onMaxTokensChange = handleChange(setMaxTokens, (value) => onUpdateAssistantSettings({ maxTokens: value }))
  const onTopPChange = handleChange(setTopP, (value) => onUpdateAssistantSettings({ topP: value }))

  const onReset = () => {
    setTemperature(DEFAULT_TEMPERATURE)
    setEnableTemperature(true)
    setContextCount(DEFAULT_ASSISTANT_CONTEXT_COUNT)
    setEnableMaxTokens(false)
    setMaxTokens(DEFAULT_ASSISTANT_SETTINGS.maxTokens)
    setTopP(1)
    setEnableTopP(false)
    setToolUseMode('function')
    const settings = {
      ...DEFAULT_ASSISTANT_SETTINGS,
      contextCount: DEFAULT_ASSISTANT_CONTEXT_COUNT
    } as AssistantSettingsWithContextCount

    updateDefaultAssistant({
      ...defaultAssistant,
      settings
    })
  }

  const handleEmojiSelect = (selectedEmoji: string) => {
    setEmoji(selectedEmoji)
    updateDefaultAssistant({ ...defaultAssistant, emoji: selectedEmoji, name })
  }

  const handleEmojiDelete = () => {
    setEmoji('')
    updateDefaultAssistant({ ...defaultAssistant, emoji: '', name })
  }

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value
    setName(newName)
    updateDefaultAssistant({ ...defaultAssistant, name: newName })
  }

  return (
    <SettingContainer className="gap-6" style={{ height: 'auto', background: 'transparent', padding: 0 }} theme={theme}>
      <section className="space-y-4">
        <RowFlex className="items-center gap-3">
          <Popover>
            <div className="group/emoji relative inline-block">
              <PopoverTrigger asChild>
                <Button className="h-[30px] min-w-[30px] p-1 text-xl">{emoji}</Button>
              </PopoverTrigger>
              {emoji && (
                <CircleX
                  className="group-hover/emoji:block! absolute top-[-8px] right-[-8px] hidden size-4 cursor-pointer text-destructive"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleEmojiDelete()
                  }}
                />
              )}
            </div>
            <PopoverContent className="w-auto p-0">
              <EmojiPicker onEmojiClick={handleEmojiSelect} />
            </PopoverContent>
          </Popover>
          <Input
            placeholder={t('common.assistant') + t('common.name')}
            value={name}
            onChange={handleNameChange}
            className="flex-1"
          />
        </RowFlex>

        <div className="space-y-2">
          <SettingSubtitle className="mt-0">{t('common.prompt')}</SettingSubtitle>
          <Textarea.Input
            rows={4}
            placeholder={t('common.assistant') + t('common.prompt')}
            value={defaultAssistant.prompt}
            onChange={(e) => updateDefaultAssistant({ ...defaultAssistant, prompt: e.target.value })}
            spellCheck={false}
          />
        </div>
      </section>

      <section className="space-y-3">
        <SettingSubtitle className="mt-0 flex items-center justify-between">
          {t('settings.assistant.model_params')}
          <Tooltip content={t('common.reset')}>
            <Button variant="ghost" onClick={onReset} size="icon">
              <ResetIcon size={16} />
            </Button>
          </Tooltip>
        </SettingSubtitle>

        <div className="rounded-md border border-border/60 bg-muted/20 px-4">
          <div className={PARAMETER_ROW_CLASS}>
            <SettingRow>
              <RowFlex className="items-center">
                <p className="m-0 mr-1.25 text-sm">{t('chat.settings.temperature.label')}</p>
                <HelpTooltip
                  content={t('chat.settings.temperature.tip')}
                  iconProps={{ className: 'cursor-pointer text-[var(--color-foreground-muted)]' }}
                />
              </RowFlex>
              <Switch
                style={{ marginLeft: 10 }}
                checked={enableTemperature}
                onCheckedChange={(enabled) => {
                  setEnableTemperature(enabled)
                  onUpdateAssistantSettings({ enableTemperature: enabled })
                }}
              />
            </SettingRow>
            {enableTemperature && (
              <div className={PARAMETER_SLIDER_CLASS}>
                <ParameterSlider
                  min={0}
                  max={2}
                  value={typeof temperature === 'number' ? temperature : 0}
                  marks={{ 0: '0', 0.7: '0.7', 2: '2' }}
                  step={0.01}
                  onChange={setTemperature}
                  onCommit={onTemperatureChange}
                />
              </div>
            )}
          </div>

          <div className={PARAMETER_ROW_CLASS}>
            <SettingRow>
              <RowFlex className="items-center">
                <p className="m-0 mr-1.25 text-sm">{t('chat.settings.top_p.label')}</p>
                <HelpTooltip
                  content={t('chat.settings.top_p.tip')}
                  iconProps={{ className: 'cursor-pointer text-[var(--color-foreground-muted)]' }}
                />
              </RowFlex>
              <Switch
                style={{ marginLeft: 10 }}
                checked={enableTopP}
                onCheckedChange={(enabled) => {
                  setEnableTopP(enabled)
                  onUpdateAssistantSettings({ enableTopP: enabled })
                }}
              />
            </SettingRow>
            {enableTopP && (
              <div className={PARAMETER_SLIDER_CLASS}>
                <ParameterSlider
                  min={0}
                  max={1}
                  value={typeof topP === 'number' ? topP : 1}
                  marks={{ 0: '0', 0.5: '0.5', 1: '1' }}
                  step={0.01}
                  onChange={setTopP}
                  onCommit={onTopPChange}
                />
              </div>
            )}
          </div>

          <div className={PARAMETER_ROW_CLASS}>
            <div className="flex items-center">
              <p className="m-0 mr-1.25 text-sm">{t('chat.settings.context_count.label')}</p>
              <HelpTooltip
                content={t('chat.settings.context_count.tip')}
                iconProps={{ className: 'cursor-pointer text-color-text-3' }}
              />
            </div>
            <div className={PARAMETER_SLIDER_CLASS}>
              <ParameterSlider
                min={0}
                max={20}
                marks={{ 0: '0', 5: '5', 10: '10', 15: '15', 20: t('chat.settings.max') }}
                value={typeof contextCount === 'number' ? contextCount : 0}
                step={1}
                onChange={setContextCount}
                onCommit={onContextCountChange}
              />
            </div>
          </div>

          <div className={PARAMETER_ROW_CLASS}>
            <Flex className="items-center justify-between">
              <RowFlex className="items-center">
                <p className="m-0 mr-1.25 text-sm">{t('chat.settings.max_tokens.label')}</p>
                <HelpTooltip
                  content={t('chat.settings.max_tokens.tip')}
                  iconProps={{ className: 'cursor-pointer text-[var(--color-foreground-muted)]' }}
                />
              </RowFlex>
              <Switch
                style={{ marginLeft: 10 }}
                checked={enableMaxTokens}
                onCheckedChange={async (enabled) => {
                  if (enabled) {
                    const confirmed = await modalConfirm({
                      title: t('chat.settings.max_tokens.confirm'),
                      content: t('chat.settings.max_tokens.confirm_content'),
                      okText: t('common.confirm'),
                      cancelText: t('common.cancel')
                    })
                    if (!confirmed) return
                  }

                  setEnableMaxTokens(enabled)
                  onUpdateAssistantSettings({ enableMaxTokens: enabled })
                }}
              />
            </Flex>
            {enableMaxTokens && (
              <div className="mt-3">
                <EditableNumber
                  disabled={!enableMaxTokens}
                  min={0}
                  max={10000000}
                  step={100}
                  value={maxTokens}
                  changeOnBlur
                  onChange={onMaxTokensChange}
                  size="small"
                  align="start"
                  className="w-full"
                />
              </div>
            )}
          </div>

          <div className={PARAMETER_ROW_CLASS}>
            <SettingRow>
              <p className="m-0 mr-1.25 text-sm">{t('assistants.settings.tool_use_mode.label')}</p>
              <Selector
                value={toolUseMode}
                options={[
                  { label: t('assistants.settings.tool_use_mode.prompt'), value: 'prompt' },
                  { label: t('assistants.settings.tool_use_mode.function'), value: 'function' }
                ]}
                onChange={(value) => {
                  setToolUseMode(value)
                  onUpdateAssistantSettings({ toolUseMode: value })
                }}
                size={14}
              />
            </SettingRow>
          </div>
        </div>
      </section>
    </SettingContainer>
  )
}

interface Props {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()

  const onClose = () => {
    setOpen(false)
    resolve({})
  }

  DefaultAssistantSettingsPopup.hide = onClose

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose()
        } else {
          setOpen(true)
        }
      }}>
      <DialogContent className="w-[500px]">
        <DialogHeader>
          <DialogTitle>{t('settings.assistant.title')}</DialogTitle>
        </DialogHeader>
        <AssistantSettings />
      </DialogContent>
    </Dialog>
  )
}

const TopViewKey = 'DefaultAssistantSettingsPopup'

export default class DefaultAssistantSettingsPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show() {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          resolve={(v) => {
            resolve(v)
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}
