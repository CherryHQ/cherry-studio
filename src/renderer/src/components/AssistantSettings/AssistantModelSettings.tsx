import { PlusOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import { DEFAULT_CONTEXTCOUNT, DEFAULT_TEMPERATURE } from '@renderer/config/constant'
import { SettingRow } from '@renderer/pages/settings'
import { Assistant, AssistantSettings } from '@renderer/types'
import { Button, Col, Divider, Row, Slider, Switch, Tooltip } from 'antd'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import ModelAvatar from '../Avatar/ModelAvatar'
import SelectModelPopup from '../Popups/SelectModelPopup'

interface Props {
  assistant: Assistant
  updateAssistant: (assistant: Assistant) => void
  updateAssistantSettings: (settings: Partial<AssistantSettings>) => void
}

const AssistantModelSettings: FC<Props> = ({ assistant, updateAssistant, updateAssistantSettings }) => {
  const [temperature, setTemperature] = useState(assistant?.settings?.temperature ?? DEFAULT_TEMPERATURE)
  const [contextCount, setContextCount] = useState(assistant?.settings?.contextCount ?? DEFAULT_CONTEXTCOUNT)
  const [enableMaxTokens, setEnableMaxTokens] = useState(assistant?.settings?.enableMaxTokens ?? false)
  const [maxTokens, setMaxTokens] = useState(assistant?.settings?.maxTokens ?? 0)
  const [autoResetModel, setAutoResetModel] = useState(assistant?.settings?.autoResetModel ?? false)
  const [streamOutput, setStreamOutput] = useState(assistant?.settings?.streamOutput ?? true)
  const [defaultModel, setDefaultModel] = useState(assistant?.defaultModel)
  const { t } = useTranslation()

  const onTemperatureChange = (value) => {
    if (!isNaN(value as number)) {
      updateAssistantSettings({ temperature: value })
    }
  }

  const onContextCountChange = (value) => {
    if (!isNaN(value as number)) {
      updateAssistantSettings({ contextCount: value })
    }
  }

  const onMaxTokensChange = (value) => {
    if (!isNaN(value as number)) {
      updateAssistantSettings({ maxTokens: value })
    }
  }

  const onReset = () => {
    setTemperature(DEFAULT_TEMPERATURE)
    setContextCount(DEFAULT_CONTEXTCOUNT)
    setEnableMaxTokens(false)
    setMaxTokens(0)
    setStreamOutput(true)
    updateAssistantSettings({
      temperature: DEFAULT_TEMPERATURE,
      contextCount: DEFAULT_CONTEXTCOUNT,
      enableMaxTokens: false,
      maxTokens: 0,
      streamOutput: true
    })
  }

  const onSelectModel = async () => {
    const selectedModel = await SelectModelPopup.show({ model: assistant?.model })
    if (selectedModel) {
      setDefaultModel(selectedModel)
      updateAssistant({
        ...assistant,
        defaultModel: selectedModel
      })
    }
  }

  return (
    <Container>
      <Row align="middle" style={{ marginBottom: 10 }}>
        <Label style={{ marginBottom: 10 }}>{t('assistants.settings.default_model')}</Label>
        <Col span={24}>
          <HStack alignItems="center">
            <Button
              icon={defaultModel ? <ModelAvatar model={defaultModel} size={20} /> : <PlusOutlined />}
              onClick={onSelectModel}>
              {defaultModel ? defaultModel.name : t('agents.edit.model.select.title')}
            </Button>
          </HStack>
        </Col>
      </Row>
      <Divider style={{ margin: '10px 0' }} />
      <SettingRow style={{ minHeight: 30 }}>
        <Label>
          {t('assistants.settings.auto_reset_model')}{' '}
          <Tooltip title={t('assistants.settings.auto_reset_model.tip')}>
            <QuestionIcon />
          </Tooltip>
        </Label>
        <Switch
          value={autoResetModel}
          onChange={(checked) => {
            setAutoResetModel(checked)
            updateAssistantSettings({ autoResetModel: checked })
          }}
        />
      </SettingRow>
      <Divider style={{ margin: '10px 0' }} />
      <Row align="middle">
        <Label>{t('chat.settings.temperature')}</Label>
        <Tooltip title={t('chat.settings.temperature.tip')}>
          <QuestionIcon />
        </Tooltip>
      </Row>
      <Row align="middle" gutter={10}>
        <Col span={24}>
          <Slider
            min={0}
            max={2}
            onChange={setTemperature}
            onChangeComplete={onTemperatureChange}
            value={typeof temperature === 'number' ? temperature : 0}
            step={0.1}
          />
        </Col>
      </Row>
      <Row align="middle">
        <Label>
          {t('chat.settings.context_count')}{' '}
          <Tooltip title={t('chat.settings.context_count.tip')}>
            <QuestionIcon />
          </Tooltip>
        </Label>
      </Row>
      <Row align="middle" gutter={10}>
        <Col span={24}>
          <Slider
            min={0}
            max={20}
            onChange={setContextCount}
            onChangeComplete={onContextCountChange}
            value={typeof contextCount === 'number' ? contextCount : 0}
            step={1}
          />
        </Col>
      </Row>
      <Row align="middle" justify="space-between">
        <HStack alignItems="center">
          <Label>{t('chat.settings.max_tokens')}</Label>
          <Tooltip title={t('chat.settings.max_tokens.tip')}>
            <QuestionIcon />
          </Tooltip>
        </HStack>
        <Switch
          checked={enableMaxTokens}
          onChange={(enabled) => {
            setEnableMaxTokens(enabled)
            updateAssistantSettings({ enableMaxTokens: enabled })
          }}
        />
      </Row>
      <Row align="middle" gutter={10}>
        <Col span={24}>
          <Slider
            disabled={!enableMaxTokens}
            min={0}
            max={32000}
            onChange={setMaxTokens}
            onChangeComplete={onMaxTokensChange}
            value={typeof maxTokens === 'number' ? maxTokens : 0}
            step={100}
          />
        </Col>
      </Row>
      <SettingRow>
        <Label>{t('model.stream_output')}</Label>
        <Switch
          checked={streamOutput}
          onChange={(checked) => {
            setStreamOutput(checked)
            updateAssistantSettings({ streamOutput: checked })
          }}
        />
      </SettingRow>
      <Divider style={{ margin: '15px 0' }} />
      <HStack justifyContent="flex-end">
        <Button onClick={onReset} style={{ width: 80 }} danger type="primary">
          {t('chat.settings.reset')}
        </Button>
      </HStack>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  padding: 5px;
`

const Label = styled.p`
  margin-right: 5px;
  font-weight: 500;
`

const QuestionIcon = styled(QuestionCircleOutlined)`
  font-size: 12px;
  cursor: pointer;
  color: var(--color-text-3);
`

export default AssistantModelSettings
