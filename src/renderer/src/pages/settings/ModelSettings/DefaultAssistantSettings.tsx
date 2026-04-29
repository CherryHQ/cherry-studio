import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Divider,
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
import { DEFAULT_CONTEXTCOUNT, DEFAULT_TEMPERATURE } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useDefaultAssistant } from '@renderer/hooks/useAssistant'
import { DEFAULT_ASSISTANT_SETTINGS } from '@renderer/services/AssistantService'
import type { AssistantSettings as AssistantSettingsType } from '@renderer/types'
import { getLeadingEmoji, modalConfirm } from '@renderer/utils'
import { CircleX } from 'lucide-react'
import type { Dispatch, FC, SetStateAction } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingRow, SettingSubtitle } from '..'
import ParameterSlider from './ParameterSlider'

const AssistantSettings: FC = () => {
  const { defaultAssistant, updateDefaultAssistant } = useDefaultAssistant()
  const [temperature, setTemperature] = useState(defaultAssistant.settings?.temperature ?? DEFAULT_TEMPERATURE)
  const [enableTemperature, setEnableTemperature] = useState(defaultAssistant.settings?.enableTemperature ?? false)
  const [contextCount, setContextCount] = useState(defaultAssistant.settings?.contextCount ?? DEFAULT_CONTEXTCOUNT)
  const [enableMaxTokens, setEnableMaxTokens] = useState(defaultAssistant?.settings?.enableMaxTokens ?? false)
  const [maxTokens, setMaxTokens] = useState(defaultAssistant?.settings?.maxTokens ?? 0)
  const [topP, setTopP] = useState(defaultAssistant.settings?.topP ?? 1)
  const [enableTopP, setEnableTopP] = useState(defaultAssistant.settings?.enableTopP ?? false)
  const [toolUseMode, setToolUseMode] = useState<AssistantSettingsType['toolUseMode']>(
    defaultAssistant.settings?.toolUseMode ?? 'function'
  )
  const [emoji, setEmoji] = useState(defaultAssistant.emoji || getLeadingEmoji(defaultAssistant.name) || '')
  const [name, setName] = useState(
    defaultAssistant.name.replace(getLeadingEmoji(defaultAssistant.name) || '', '').trim()
  )
  const { theme } = useTheme()

  const { t } = useTranslation()

  const onUpdateAssistantSettings = (settings: Partial<AssistantSettingsType>) => {
    updateDefaultAssistant({
      ...defaultAssistant,
      settings: {
        ...defaultAssistant.settings,
        temperature: settings.temperature ?? temperature,
        enableTemperature: settings.enableTemperature ?? enableTemperature,
        contextCount: settings.contextCount ?? contextCount,
        enableMaxTokens: settings.enableMaxTokens ?? enableMaxTokens,
        maxTokens: settings.maxTokens ?? maxTokens,
        streamOutput: settings.streamOutput ?? true,
        topP: settings.topP ?? topP,
        enableTopP: settings.enableTopP ?? enableTopP,
        toolUseMode: settings.toolUseMode ?? toolUseMode
      }
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
    setContextCount(DEFAULT_CONTEXTCOUNT)
    setEnableMaxTokens(false)
    setMaxTokens(0)
    setTopP(1)
    setEnableTopP(false)
    setToolUseMode('function')
    updateDefaultAssistant({
      ...defaultAssistant,
      settings: { ...DEFAULT_ASSISTANT_SETTINGS }
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
    <SettingContainer
      style={{ height: 'auto', background: 'transparent', padding: `0 0 12px 0`, gap: 10 }}
      theme={theme}>
      <RowFlex className="items-center gap-2" style={{ marginTop: 10 }}>
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
      <SettingSubtitle style={{ marginTop: 0 }}>{t('common.prompt')}</SettingSubtitle>
      <Textarea.Input
        rows={4}
        placeholder={t('common.assistant') + t('common.prompt')}
        value={defaultAssistant.prompt}
        onChange={(e) => updateDefaultAssistant({ ...defaultAssistant, prompt: e.target.value })}
        spellCheck={false}
      />
      <SettingSubtitle
        style={{
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'space-between',
          marginTop: 0
        }}>
        {t('settings.assistant.model_params')}
        <Tooltip content={t('common.reset')}>
          <Button variant="ghost" onClick={onReset} size="icon">
            <ResetIcon size={16} />
          </Button>
        </Tooltip>
      </SettingSubtitle>
      <Divider style={{ margin: '2px 0' }} />
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
        <div className="mt-[-5px] mb-[-10px] grid grid-cols-[minmax(0,1fr)_96px] items-center gap-3">
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
      <Divider style={{ margin: '2px 0' }} />
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
        <div className="mt-[-5px] mb-[-10px] grid grid-cols-[minmax(0,1fr)_96px] items-center gap-3">
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
      <Divider style={{ margin: '2px 0' }} />
      <div className="flex items-center">
        <p className="m-0 mr-1.25 text-sm">{t('chat.settings.context_count.label')}</p>
        <HelpTooltip
          content={t('chat.settings.context_count.tip')}
          iconProps={{ className: 'cursor-pointer text-color-text-3' }}
        />
      </div>
      <div className="mt-[-5px] mb-[-10px] grid grid-cols-[minmax(0,1fr)_104px] items-center gap-5">
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
      <Divider style={{ margin: '2px 0' }} />
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
                okButtonProps: {
                  danger: true
                }
              })
              if (!confirmed) return
            }

            setEnableMaxTokens(enabled)
            onUpdateAssistantSettings({ enableMaxTokens: enabled })
          }}
        />
      </Flex>
      {enableMaxTokens && (
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
      )}
      <Divider style={{ margin: '2px 0' }} />
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
