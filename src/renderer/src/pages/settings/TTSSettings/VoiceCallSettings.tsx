import { InfoCircleOutlined, PhoneOutlined } from '@ant-design/icons'
import SelectModelPopup from '@renderer/components/Popups/SelectModelPopup'
import { getModelLogo } from '@renderer/config/models'
import { useAppDispatch } from '@renderer/store'
import { setVoiceCallEnabled, setVoiceCallModel } from '@renderer/store/settings'
import { Button, Form, Space, Switch, Tooltip as AntTooltip } from 'antd'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

const VoiceCallSettings: FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  // 从 Redux 获取通话功能设置
  const voiceCallEnabled = useSelector((state: any) => state.settings.voiceCallEnabled ?? true)
  const voiceCallModel = useSelector((state: any) => state.settings.voiceCallModel)

  // 模型选择状态
  const [, setIsSelectingModel] = useState(false)

  // 选择模型
  const handleSelectModel = async () => {
    setIsSelectingModel(true)
    try {
      const model = await SelectModelPopup.show({})
      if (model) {
        dispatch(setVoiceCallModel(model))
      }
    } catch (error) {
      console.error('选择模型失败:', error)
    } finally {
      setIsSelectingModel(false)
    }
  }

  return (
    <Container>
      <Form layout="vertical">
        {/* 通话功能开关 */}
        <Form.Item>
          <Space>
            <Switch checked={voiceCallEnabled} onChange={(checked) => dispatch(setVoiceCallEnabled(checked))} />
            <span>{t('settings.voice_call.enable')}</span>
            <AntTooltip title={t('settings.voice_call.enable.help')}>
              <InfoCircleOutlined style={{ color: 'var(--color-text-3)' }} />
            </AntTooltip>
          </Space>
        </Form.Item>

        {/* 模型选择 */}
        <Form.Item label={t('settings.voice_call.model')} style={{ marginBottom: 16 }}>
          <Space>
            <Button
              onClick={handleSelectModel}
              disabled={!voiceCallEnabled}
              icon={
                voiceCallModel ? (
                  <ModelIcon src={getModelLogo(voiceCallModel.id)} alt="Model logo" />
                ) : (
                  <PhoneOutlined style={{ marginRight: 8 }} />
                )
              }>
              {voiceCallModel ? voiceCallModel.name : t('settings.voice_call.model.select')}
            </Button>
            {voiceCallModel && (
              <InfoText>{t('settings.voice_call.model.current', { model: voiceCallModel.name })}</InfoText>
            )}
          </Space>
          <InfoText>{t('settings.voice_call.model.info')}</InfoText>
        </Form.Item>

        {/* ASR 和 TTS 设置提示 */}
        <Form.Item>
          <Alert type="info">{t('settings.voice_call.asr_tts_info')}</Alert>
        </Form.Item>

        {/* 测试按钮 */}
        <Form.Item>
          <Button
            type="primary"
            icon={<PhoneOutlined />}
            disabled={!voiceCallEnabled}
            onClick={() =>
              window.message.info({ content: t('settings.voice_call.test_info'), key: 'voice-call-test' })
            }>
            {t('settings.voice_call.test')}
          </Button>
        </Form.Item>
      </Form>
    </Container>
  )
}

const Container = styled.div`
  padding: 0 0 20px 0;
`

const InfoText = styled.div`
  color: var(--color-text-3);
  font-size: 12px;
  margin-top: 4px;
`

const ModelIcon = styled.img`
  width: 16px;
  height: 16px;
  margin-right: 8px;
`

const Alert = styled.div<{ type: 'info' | 'warning' | 'error' | 'success' }>`
  padding: 8px 12px;
  border-radius: 4px;
  background-color: ${(props) =>
    props.type === 'info'
      ? 'var(--color-info-bg)'
      : props.type === 'warning'
        ? 'var(--color-warning-bg)'
        : props.type === 'error'
          ? 'var(--color-error-bg)'
          : 'var(--color-success-bg)'};
  border: 1px solid
    ${(props) =>
      props.type === 'info'
        ? 'var(--color-info-border)'
        : props.type === 'warning'
          ? 'var(--color-warning-border)'
          : props.type === 'error'
            ? 'var(--color-error-border)'
            : 'var(--color-success-border)'};
  color: ${(props) =>
    props.type === 'info'
      ? 'var(--color-info-text)'
      : props.type === 'warning'
        ? 'var(--color-warning-text)'
        : props.type === 'error'
          ? 'var(--color-error-text)'
          : 'var(--color-success-text)'};
`

export default VoiceCallSettings
