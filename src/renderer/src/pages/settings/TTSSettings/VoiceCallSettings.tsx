import { InfoCircleOutlined, PhoneOutlined, ReloadOutlined } from '@ant-design/icons'
import SelectModelPopup from '@renderer/components/Popups/SelectModelPopup'
import { getModelLogo } from '@renderer/config/models'
import { DEFAULT_VOICE_CALL_PROMPT } from '@renderer/config/prompts'
import { useAppDispatch } from '@renderer/store'
import { setVoiceCallEnabled, setVoiceCallModel, setVoiceCallPrompt } from '@renderer/store/settings'
import { Button, Form, Input, Space, Switch, Tooltip as AntTooltip } from 'antd'
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
  const voiceCallPrompt = useSelector((state: any) => state.settings.voiceCallPrompt)

  // 提示词编辑状态
  const [promptText, setPromptText] = useState<string>(voiceCallPrompt || DEFAULT_VOICE_CALL_PROMPT)

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

  // 保存提示词
  const handleSavePrompt = () => {
    dispatch(setVoiceCallPrompt(promptText))
    window.message.success({ content: t('settings.voice_call.prompt.saved'), key: 'voice-call-prompt' })
  }

  // 重置提示词
  const handleResetPrompt = () => {
    setPromptText(DEFAULT_VOICE_CALL_PROMPT)
    dispatch(setVoiceCallPrompt(null))
    window.message.success({ content: t('settings.voice_call.prompt.reset_done'), key: 'voice-call-prompt' })
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
                  <ModelIcon
                    src={getModelLogo(voiceCallModel.id)}
                    alt="Model logo"
                    style={{ width: 20, height: 20, borderRadius: 10 }}
                  />
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
        {/* 提示词设置 */}
        <Form.Item label={t('settings.voice_call.prompt.label')} style={{ marginBottom: 16 }}>
          <Input.TextArea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            disabled={!voiceCallEnabled}
            rows={8}
            placeholder={t('settings.voice_call.prompt.placeholder')}
          />
          <InfoText>{t('settings.voice_call.prompt.info')}</InfoText>
          <Space style={{ marginTop: 8 }}>
            <Button type="primary" onClick={handleSavePrompt} disabled={!voiceCallEnabled}>
              {t('settings.voice_call.prompt.save')}
            </Button>
            <Button onClick={handleResetPrompt} disabled={!voiceCallEnabled} icon={<ReloadOutlined />}>
              {t('settings.voice_call.prompt.reset')}
            </Button>
          </Space>
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
  width: 20px;
  height: 20px;
  border-radius: 10px;
  margin-top: 4px;
`

// const Alert = styled.div<{ type: 'info' | 'warning' | 'error' | 'success' }>`
//   padding: 8px 12px;
//   border-radius: 4px;
//   background-color: ${(props) =>
//     props.type === 'info'
//       ? 'var(--color-info-bg)'
//       : props.type === 'warning'
//         ? 'var(--color-warning-bg)'
//         : props.type === 'error'
//           ? 'var(--color-error-bg)'
//           : 'var(--color-success-bg)'};
//   border: 1px solid
//     ${(props) =>
//       props.type === 'info'
//         ? 'var(--color-info-border)'
//         : props.type === 'warning'
//           ? 'var(--color-warning-border)'
//           : props.type === 'error'
//             ? 'var(--color-error-border)'
//             : 'var(--color-success-border)'};
//   color: ${(props) =>
//     props.type === 'info'
//       ? 'var(--color-info-text)'
//       : props.type === 'warning'
//         ? 'var(--color-warning-text)'
//         : props.type === 'error'
//           ? 'var(--color-error-text)'
//           : 'var(--color-success-text)'};
// `

export default VoiceCallSettings
