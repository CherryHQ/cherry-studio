import { QuestionCircleOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import { DEFAULT_CONTEXTCOUNT, DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE } from '@renderer/config/constant'
import { useDefaultAssistant } from '@renderer/hooks/useAssistant'
import { AssistantSettings as AssistantSettingsType } from '@renderer/types'
import { Button, Col, Input, InputNumber, Row, Slider, Switch, Tooltip } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { Dispatch, FC, SetStateAction, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingDivider, SettingSubtitle, SettingTitle } from '.'

const AssistantSettings: FC = () => {
  const { defaultAssistant, updateDefaultAssistant } = useDefaultAssistant()
  const [temperature, setTemperature] = useState(defaultAssistant.settings?.temperature ?? DEFAULT_TEMPERATURE)
  const [contextCount, setContextCount] = useState(defaultAssistant.settings?.contextCount ?? DEFAULT_CONTEXTCOUNT)
  const [enableMaxTokens, setEnableMaxTokens] = useState(defaultAssistant?.settings?.enableMaxTokens ?? false)
  const [maxTokens, setMaxTokens] = useState(defaultAssistant?.settings?.maxTokens ?? 0)

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
        streamOutput: settings.streamOutput ?? true
      }
    })
  }

  const handleChange =
    (setter: Dispatch<SetStateAction<number>>, updater: (value: number) => void) => (value: number | null) => {
      if (!!value && !isNaN(value)) {
        setter(value)
        updater(value)
      }
    }
  const onTemperatureChange = handleChange(setTemperature, (value) => onUpdateAssistantSettings({ temperature: value }))
  const onContextCountChange = handleChange(setContextCount, (value) =>
    onUpdateAssistantSettings({ contextCount: value })
  )
  const onMaxTokensChange = handleChange(setMaxTokens, (value) => onUpdateAssistantSettings({ maxTokens: value }))

  const onReset = () => {
    setTemperature(DEFAULT_TEMPERATURE)
    setContextCount(DEFAULT_CONTEXTCOUNT)
    setEnableMaxTokens(false)
    setMaxTokens(0)
    updateDefaultAssistant({
      ...defaultAssistant,
      settings: {
        ...defaultAssistant.settings,
        temperature: DEFAULT_TEMPERATURE,
        contextCount: DEFAULT_CONTEXTCOUNT,
        enableMaxTokens: false,
        maxTokens: DEFAULT_MAX_TOKENS,
        streamOutput: true
      }
    })
  }

  return (
    <SettingContainer>
      <SettingTitle>{t('settings.assistant.title')}</SettingTitle>
      <SettingDivider />
      <SettingSubtitle style={{ marginTop: 0 }}>{t('common.name')}</SettingSubtitle>
      <Input
        placeholder={t('common.assistant') + t('common.name')}
        value={defaultAssistant.name}
        onChange={(e) => updateDefaultAssistant({ ...defaultAssistant, name: e.target.value })}
        style={{ margin: '10px 0' }}
      />
      <SettingSubtitle>{t('common.prompt')}</SettingSubtitle>
      <TextArea
        rows={4}
        placeholder={t('common.assistant') + t('common.prompt')}
        value={defaultAssistant.prompt}
        onChange={(e) => updateDefaultAssistant({ ...defaultAssistant, prompt: e.target.value })}
        style={{ margin: '10px 0' }}
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
        <Col span={21}>
          <Slider
            min={0}
            max={2}
            onChange={setTemperature}
            onChangeComplete={onTemperatureChange}
            value={typeof temperature === 'number' ? temperature : 0}
            marks={{ 0: '0', 0.7: '0.7', 2: '2' }}
            step={0.1}
          />
        </Col>
        <Col span={3}>
          <InputNumber
            min={0}
            max={2}
            step={0.1}
            value={temperature}
            onChange={onTemperatureChange}
            style={{ width: '100%' }}
          />
        </Col>
      </Row>
      <Row align="middle">
        <Label>{t('chat.settings.context_count')}</Label>
        <Tooltip title={t('chat.settings.context_count.tip')}>
          <QuestionIcon />
        </Tooltip>
      </Row>
      <Row align="middle" style={{ marginBottom: 10 }} gutter={20}>
        <Col span={21}>
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
        <Col span={3}>
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
      <Row align="middle">
        <HStack alignItems="center">
          <Label>{t('chat.settings.max_tokens')}</Label>
          <Tooltip title={t('chat.settings.max_tokens.tip')}>
            <QuestionIcon />
          </Tooltip>
        </HStack>
        <Switch
          style={{ marginLeft: 10 }}
          checked={enableMaxTokens}
          onChange={(enabled) => {
            setEnableMaxTokens(enabled)
            onUpdateAssistantSettings({ enableMaxTokens: enabled })
          }}
        />
      </Row>
      <Row align="middle" gutter={20}>
        <Col span={21}>
          <Slider
            disabled={!enableMaxTokens}
            min={0}
            max={32000}
            onChange={setMaxTokens}
            onChangeComplete={onMaxTokensChange}
            value={typeof maxTokens === 'number' ? maxTokens : 0}
            step={100}
            marks={{
              0: '0',
              32000: t('chat.settings.max')
            }}
          />
        </Col>
        <Col span={3}>
          <InputNumber
            disabled={!enableMaxTokens}
            min={0}
            max={32000}
            step={100}
            value={maxTokens}
            onChange={onMaxTokensChange}
            controls={true}
            style={{ width: '100%' }}
          />
        </Col>
      </Row>
    </SettingContainer>
  )
}

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

export default AssistantSettings
