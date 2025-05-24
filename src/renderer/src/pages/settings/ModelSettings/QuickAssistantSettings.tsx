import { QuestionCircleOutlined } from '@ant-design/icons'
import { TopView } from '@renderer/components/TopView'
import { DEFAULT_CONTEXTCOUNT, DEFAULT_TEMPERATURE } from '@renderer/config/constant'
import { useQuickAssistant } from '@renderer/hooks/useAssistant'
import { AssistantSettings as AssistantSettingsType } from '@renderer/types'
import { Button, Col, InputNumber, Modal, Row, Slider, Tooltip } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { Dispatch, FC, SetStateAction, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingSubtitle } from '..'

const QuickAssistantSettings: FC = () => {
  const { quickAssistant, updateQuickAssistant } = useQuickAssistant()
  const [temperature, setTemperature] = useState(quickAssistant.settings?.temperature ?? DEFAULT_TEMPERATURE)
  const [contextCount, setContextCount] = useState(quickAssistant.settings?.contextCount ?? DEFAULT_CONTEXTCOUNT)
  const [topP, setTopP] = useState(quickAssistant.settings?.topP ?? 1)

  const { t } = useTranslation()

  const onUpdateAssistantSettings = (settings: Partial<AssistantSettingsType>) => {
    console.log('Updating assistant settings:', {
      ...quickAssistant.settings,
      ...settings
    })
    updateQuickAssistant({
      ...quickAssistant,
      settings: {
        ...quickAssistant.settings,
        temperature: settings.temperature ?? temperature,
        contextCount: settings.contextCount ?? contextCount,
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
  const onTopPChange = handleChange(setTopP, (value) => onUpdateAssistantSettings({ topP: value }))

  const onReset = () => {
    setTemperature(DEFAULT_TEMPERATURE)
    setContextCount(DEFAULT_CONTEXTCOUNT)
    setTopP(1)
    updateQuickAssistant({
      ...quickAssistant,
      settings: {
        ...quickAssistant.settings,
        temperature: DEFAULT_TEMPERATURE,
        contextCount: DEFAULT_CONTEXTCOUNT,
        streamOutput: true,
        topP: 1
      }
    })
  }

  return (
    <SettingContainer style={{ height: 'auto', background: 'transparent', padding: 0 }}>
      <SettingSubtitle>{t('common.prompt')}</SettingSubtitle>
      <TextArea
        rows={4}
        placeholder={t('common.assistant') + t('common.prompt')}
        value={quickAssistant.prompt}
        onChange={(e) => {
          const newPrompt = e.target.value
          updateQuickAssistant({
            ...quickAssistant,
            prompt: newPrompt
          })
        }}
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
        <Button onClick={onReset} style={{ width: 90 }}>
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
        <Col span={20}>
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
        <Col span={4}>
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
        <Col span={20}>
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
        <Col span={4}>
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
        <Col span={20}>
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
        <Col span={4}>
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
    </SettingContainer>
  )
}

interface Props {
  resolve: (data: any) => void
}

const PopupContainer = ({ resolve }: Props) => {
  const { t } = useTranslation()

  const [open, setOpen] = useState(true)

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  QuickAssistantSettingsPopup.hide = onCancel

  return (
    <Modal
      title={t('settings.quickAssistant.title')}
      open={open}
      onCancel={onCancel}
      afterClose={onClose}
      transitionName="animation-move-down"
      centered
      footer={null}>
      <QuickAssistantSettings />
    </Modal>
  )
}

const TopViewKey = 'QuickAssistantSettingsPopup'

export default class QuickAssistantSettingsPopup {
  static topviewId = 0

  static hide() {
    TopView.hide(TopViewKey)
  }

  static show() {
    return new Promise((resolve) => {
      TopView.show(
        <PopupContainer
          resolve={(data) => {
            TopView.hide(TopViewKey)
            resolve(data)
          }}
        />,
        TopViewKey
      )
    })
  }
}

const Label = styled.span`
  color: var(--color-text);
  font-weight: 500;
  font-size: 14px;
  line-height: 20px;
  margin-right: 8px;
`

const QuestionIcon = styled(QuestionCircleOutlined)`
  color: var(--color-text-secondary);
  font-size: 14px;
  cursor: help;
`
