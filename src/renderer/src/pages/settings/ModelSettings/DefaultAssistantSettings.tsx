import { CloseCircleFilled, QuestionCircleOutlined } from '@ant-design/icons'
import EmojiPicker from '@renderer/components/EmojiPicker'
import { HStack } from '@renderer/components/Layout'
import { TopView } from '@renderer/components/TopView'
import { DEFAULT_CONTEXTCOUNT, DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useDefaultAssistant } from '@renderer/hooks/useAssistant'
import { AssistantSettings as AssistantSettingsType } from '@renderer/types'
import { getLeadingEmoji, modalConfirm } from '@renderer/utils'
import { Button, Col, Flex, Input, InputNumber, Modal, Popover, Row, Slider, Switch, Tooltip } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { Dispatch, FC, SetStateAction, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingSubtitle } from '..'

const AssistantSettings: FC = () => {
  const { defaultAssistant, updateDefaultAssistant } = useDefaultAssistant()
  const [temperature, setTemperature] = useState(defaultAssistant.settings?.temperature ?? DEFAULT_TEMPERATURE)
  const [contextCount, setContextCount] = useState(defaultAssistant.settings?.contextCount ?? DEFAULT_CONTEXTCOUNT)
  const [enableMaxTokens, setEnableMaxTokens] = useState(defaultAssistant?.settings?.enableMaxTokens ?? false)
  const [maxTokens, setMaxTokens] = useState(defaultAssistant?.settings?.maxTokens ?? 0)
  const [topP, setTopP] = useState(defaultAssistant.settings?.topP ?? 1)
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
        contextCount: settings.contextCount ?? contextCount,
        enableMaxTokens: settings.enableMaxTokens ?? enableMaxTokens,
        maxTokens: settings.maxTokens ?? maxTokens,
        streamOutput: settings.streamOutput ?? true,
        topP: settings.topP ?? topP
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
    setContextCount(DEFAULT_CONTEXTCOUNT)
    setEnableMaxTokens(false)
    setMaxTokens(0)
    setTopP(1)
    updateDefaultAssistant({
      ...defaultAssistant,
      settings: {
        ...defaultAssistant.settings,
        temperature: DEFAULT_TEMPERATURE,
        contextCount: DEFAULT_CONTEXTCOUNT,
        enableMaxTokens: false,
        maxTokens: DEFAULT_MAX_TOKENS,
        streamOutput: true,
        topP: 1
      }
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
    <SettingContainer style={{ height: 'auto', background: 'transparent', padding: 0 }} theme={theme}>
      <SettingSubtitle style={{ marginTop: 0 }}>{t('common.name')}</SettingSubtitle>
      <HStack gap={8} alignItems="center" style={{ margin: '10px 0' }}>
        <Popover content={<EmojiPicker onEmojiClick={handleEmojiSelect} />} arrow>
          <EmojiButtonWrapper>
            <Button style={{ fontSize: 20, padding: '4px', minWidth: '30px', height: '30px' }}>{emoji}</Button>
            {emoji && (
              <CloseCircleFilled
                className="delete-icon"
                onClick={(e) => {
                  e.stopPropagation()
                  handleEmojiDelete()
                }}
                style={{
                  display: 'none',
                  position: 'absolute',
                  top: '-8px',
                  right: '-8px',
                  fontSize: '16px',
                  color: '#ff4d4f',
                  cursor: 'pointer'
                }}
              />
            )}
          </EmojiButtonWrapper>
        </Popover>
        <Input
          placeholder={t('common.assistant') + t('common.name')}
          value={name}
          onChange={handleNameChange}
          style={{ flex: 1 }}
        />
      </HStack>
      <SettingSubtitle>{t('common.prompt')}</SettingSubtitle>
      <TextArea
        rows={4}
        placeholder={t('common.assistant') + t('common.prompt')}
        value={defaultAssistant.prompt}
        onChange={(e) => updateDefaultAssistant({ ...defaultAssistant, prompt: e.target.value })}
        style={{ margin: '10px 0' }}
        spellCheck={false}
      />
      <SettingSubtitle
        style={{
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'space-between'
        }}>
        {t('settings.assistant.model_params')}
        <Button onClick={onReset} style={{ width: 81 }}>
          {t('chat.settings.reset')}
        </Button>
      </SettingSubtitle>
      <Row align="middle">
        <Label>{t('chat.settings.temperature')}</Label>
        <Tooltip title={t('chat.settings.temperature.tip')}>
          <QuestionIcon />
        </Tooltip>
      </Row>
      <Row align="middle" style={{ marginBottom: 10 }} gutter={20}>
        <Col span={19}>
          <Slider
            min={0}
            max={2}
            onChange={setTemperature}
            onChangeComplete={onTemperatureChange}
            value={typeof temperature === 'number' ? temperature : 0}
            marks={{ 0: '0', 0.7: '0.7', 2: '2' }}
            step={0.01}
          />
        </Col>
        <Col span={5}>
          <InputNumber
            min={0}
            max={2}
            step={0.01}
            value={temperature}
            onChange={onTemperatureChange}
            style={{ width: '100%' }}
          />
        </Col>
      </Row>
      <Row align="middle">
        <Label>{t('chat.settings.top_p')}</Label>
        <Tooltip title={t('chat.settings.top_p.tip')}>
          <QuestionIcon />
        </Tooltip>
      </Row>
      <Row align="middle" style={{ marginBottom: 10 }} gutter={20}>
        <Col span={19}>
          <Slider
            min={0}
            max={1}
            onChange={setTopP}
            onChangeComplete={onTopPChange}
            value={typeof topP === 'number' ? topP : 1}
            marks={{ 0: '0', 0.5: '0.5', 1: '1' }}
            step={0.01}
          />
        </Col>
        <Col span={5}>
          <InputNumber min={0} max={1} step={0.01} value={topP} onChange={onTopPChange} style={{ width: '100%' }} />
        </Col>
      </Row>
      <Row align="middle">
        <Label>{t('chat.settings.context_count')}</Label>
        <Tooltip title={t('chat.settings.context_count.tip')}>
          <QuestionIcon />
        </Tooltip>
      </Row>
      <Row align="middle" style={{ marginBottom: 10 }} gutter={20}>
        <Col span={19}>
          <Slider
            min={0}
            max={20}
            marks={{ 0: '0', 5: '5', 10: '10', 15: '15', 20: t('chat.settings.max') }}
            onChange={setContextCount}
            onChangeComplete={onContextCountChange}
            value={typeof contextCount === 'number' ? contextCount : 0}
            step={1}
          />
        </Col>
        <Col span={5}>
          <InputNumber
            min={0}
            max={20}
            step={1}
            value={contextCount}
            onChange={onContextCountChange}
            style={{ width: '100%' }}
          />
        </Col>
      </Row>
      <Flex justify="space-between" align="center" style={{ marginBottom: 10 }}>
        <HStack alignItems="center">
          <Label>{t('chat.settings.max_tokens')}</Label>
          <Tooltip title={t('chat.settings.max_tokens.tip')}>
            <QuestionIcon />
          </Tooltip>
        </HStack>
        <Switch
          style={{ marginLeft: 10 }}
          checked={enableMaxTokens}
          onChange={async (enabled) => {
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
        <Row align="middle" gutter={20}>
          <Col span={24}>
            <InputNumber
              disabled={!enableMaxTokens}
              min={0}
              max={10000000}
              step={100}
              value={maxTokens}
              changeOnBlur
              onChange={onMaxTokensChange}
              style={{ width: '100%' }}
            />
          </Col>
        </Row>
      )}
    </SettingContainer>
  )
}

interface Props {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()

  const onOk = () => {
    setOpen(false)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  DefaultAssistantSettingsPopup.hide = onCancel

  return (
    <Modal
      title={t('settings.assistant.title')}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      transitionName="animation-move-down"
      centered
      width={500}
      footer={null}>
      <AssistantSettings />
    </Modal>
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

const EmojiButtonWrapper = styled.div`
  position: relative;
  display: inline-block;

  &:hover .delete-icon {
    display: block !important;
  }
`

const Label = styled.p`
  margin: 0;
  font-size: 14px;
  margin-right: 5px;
`

const QuestionIcon = styled(QuestionCircleOutlined)`
  font-size: 14px;
  cursor: pointer;
  color: var(--color-text-3);
`
