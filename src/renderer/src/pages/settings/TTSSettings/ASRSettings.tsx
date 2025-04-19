import { GlobalOutlined, InfoCircleOutlined, PlayCircleOutlined, StopOutlined } from '@ant-design/icons'
import ASRServerService from '@renderer/services/ASRServerService'
import ASRService from '@renderer/services/ASRService'
import { useAppDispatch } from '@renderer/store'
import {
  setAsrApiKey,
  setAsrApiUrl,
  setAsrAutoStartServer,
  setAsrEnabled,
  setAsrLanguage,
  setAsrModel,
  setAsrServiceType
} from '@renderer/store/settings'
import { Button, Form, Input, Select, Space, Switch } from 'antd'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

const ASRSettings: FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  // 服务器状态
  const [isServerRunning, setIsServerRunning] = useState(false)

  // 从 Redux 获取 ASR 设置
  const asrEnabled = useSelector((state: any) => state.settings.asrEnabled)
  const asrServiceType = useSelector((state: any) => state.settings.asrServiceType || 'openai')
  const asrApiKey = useSelector((state: any) => state.settings.asrApiKey)
  const asrApiUrl = useSelector((state: any) => state.settings.asrApiUrl)
  const asrModel = useSelector((state: any) => state.settings.asrModel || 'whisper-1')
  const asrAutoStartServer = useSelector((state: any) => state.settings.asrAutoStartServer)
  const asrLanguage = useSelector((state: any) => state.settings.asrLanguage || 'zh-CN')

  // 检查服务器状态
  useEffect(() => {
    if (asrServiceType === 'local') {
      setIsServerRunning(ASRServerService.isRunning())
    }
    return undefined // 添加返回值以解决TS7030错误
  }, [asrServiceType])

  // 服务类型选项
  const serviceTypeOptions = [
    { label: 'OpenAI', value: 'openai' },
    { label: t('settings.asr.service_type.local'), value: 'local' }
  ]

  // 模型选项
  const modelOptions = [{ label: 'whisper-1', value: 'whisper-1' }]

  // 语言选项
  const languageOptions = [
    { label: '中文 (Chinese)', value: 'zh-CN' },
    { label: 'English', value: 'en-US' },
    { label: '日本語 (Japanese)', value: 'ja-JP' },
    { label: 'Русский (Russian)', value: 'ru-RU' },
    { label: 'Français (French)', value: 'fr-FR' },
    { label: 'Deutsch (German)', value: 'de-DE' },
    { label: 'Español (Spanish)', value: 'es-ES' },
    { label: 'Italiano (Italian)', value: 'it-IT' },
    { label: 'Português (Portuguese)', value: 'pt-PT' },
    { label: '한국어 (Korean)', value: 'ko-KR' }
  ]

  return (
    <Container>
      <Form layout="vertical">
        {/* ASR开关 */}
        <Form.Item>
          <Space>
            <Switch checked={asrEnabled} onChange={(checked) => dispatch(setAsrEnabled(checked))} />
            <span>{t('settings.asr.enable')}</span>
            <Tooltip title={t('settings.asr.enable.help')}>
              <InfoCircleOutlined style={{ color: 'var(--color-text-3)' }} />
            </Tooltip>
          </Space>
        </Form.Item>

        {/* 服务类型选择 */}
        <Form.Item label={t('settings.asr.service_type')} style={{ marginBottom: 16 }}>
          <Select
            value={asrServiceType}
            onChange={(value) => dispatch(setAsrServiceType(value))}
            options={serviceTypeOptions}
            disabled={!asrEnabled}
            style={{ width: '100%' }}
          />
        </Form.Item>

        {/* OpenAI ASR设置 */}
        {asrServiceType === 'openai' && (
          <>
            {/* API密钥 */}
            <Form.Item label={t('settings.asr.api_key')} style={{ marginBottom: 16 }}>
              <Input.Password
                value={asrApiKey}
                onChange={(e) => dispatch(setAsrApiKey(e.target.value))}
                placeholder={t('settings.asr.api_key.placeholder')}
                disabled={!asrEnabled}
              />
            </Form.Item>

            {/* API地址 */}
            <Form.Item label={t('settings.asr.api_url')} style={{ marginBottom: 16 }}>
              <Input
                value={asrApiUrl}
                onChange={(e) => dispatch(setAsrApiUrl(e.target.value))}
                placeholder={t('settings.asr.api_url.placeholder')}
                disabled={!asrEnabled}
              />
            </Form.Item>

            {/* 模型选择 */}
            <Form.Item label={t('settings.asr.model')} style={{ marginBottom: 16 }}>
              <Select
                value={asrModel}
                onChange={(value) => dispatch(setAsrModel(value))}
                options={modelOptions}
                disabled={!asrEnabled}
                style={{ width: '100%' }}
              />
            </Form.Item>
          </>
        )}

        {/* 浏览器ASR设置 */}
        {asrServiceType === 'browser' && (
          <Form.Item>
            <Alert type="info">{t('settings.asr.browser.info')}</Alert>
          </Form.Item>
        )}

        {/* 本地服务器ASR设置 */}
        {asrServiceType === 'local' && (
          <>
            <Form.Item>
              <Alert type="info">{t('settings.asr.local.info')}</Alert>
            </Form.Item>
            <Form.Item>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Space>
                  <Button
                    type="primary"
                    icon={<PlayCircleOutlined />}
                    onClick={async () => {
                      const success = await ASRServerService.startServer()
                      if (success) {
                        setIsServerRunning(true)
                      }
                    }}
                    disabled={!asrEnabled || isServerRunning}>
                    {t('settings.asr.server.start')}
                  </Button>
                  <Button
                    danger
                    icon={<StopOutlined />}
                    onClick={async () => {
                      const success = await ASRServerService.stopServer()
                      if (success) {
                        setIsServerRunning(false)
                      }
                    }}
                    disabled={!asrEnabled || !isServerRunning}>
                    {t('settings.asr.server.stop')}
                  </Button>
                </Space>

                <Button
                  type="primary"
                  icon={<GlobalOutlined />}
                  onClick={() => window.open('http://localhost:34515', '_blank')}
                  disabled={!asrEnabled || !isServerRunning}>
                  {t('settings.asr.open_browser')}
                </Button>

                <Button
                  onClick={() => {
                    // 尝试连接到WebSocket服务器
                    ASRService.connectToWebSocketServer?.()
                      .then((connected) => {
                        if (connected) {
                          window.message.success({
                            content: t('settings.asr.local.connection_success'),
                            key: 'ws-connect'
                          })
                        } else {
                          window.message.error({
                            content: t('settings.asr.local.connection_failed'),
                            key: 'ws-connect'
                          })
                        }
                      })
                      .catch((error) => {
                        console.error('Failed to connect to WebSocket server:', error)
                        window.message.error({ content: t('settings.asr.local.connection_failed'), key: 'ws-connect' })
                      })
                  }}
                  disabled={!asrEnabled || !isServerRunning}>
                  {t('settings.asr.local.test_connection')}
                </Button>

                <BrowserTip>{t('settings.asr.local.browser_tip')}</BrowserTip>

                {/* 语言选择 */}
                <Form.Item label={t('settings.asr.language', { defaultValue: '语言' })} style={{ marginTop: 16 }}>
                  <Select
                    value={asrLanguage}
                    onChange={(value) => dispatch(setAsrLanguage(value))}
                    options={languageOptions}
                    disabled={!asrEnabled}
                    style={{ width: '100%' }}
                    showSearch
                    optionFilterProp="label"
                  />
                </Form.Item>

                {/* 启动应用自动开启服务器 */}
                <Form.Item style={{ marginTop: 16 }}>
                  <Space>
                    <Switch
                      checked={asrAutoStartServer}
                      onChange={(checked) => dispatch(setAsrAutoStartServer(checked))}
                      disabled={!asrEnabled}
                    />
                    <span>{t('settings.asr.auto_start_server')}</span>
                    <Tooltip title={t('settings.asr.auto_start_server.help')}>
                      <InfoCircleOutlined style={{ color: 'var(--color-text-3)' }} />
                    </Tooltip>
                  </Space>
                </Form.Item>
              </Space>
            </Form.Item>
          </>
        )}

        {/* 测试按钮 */}
        <Form.Item>
          <Space>
            <Button
              type="primary"
              disabled={!asrEnabled}
              onClick={() => window.message.info({ content: t('settings.asr.test_info'), key: 'asr-test' })}>
              {t('settings.asr.test')}
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

const Tooltip = styled.div`
  position: relative;
  display: inline-block;
  cursor: help;

  &:hover::after {
    content: attr(title);
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    padding: 5px 10px;
    background-color: var(--color-background-soft);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    white-space: nowrap;
    z-index: 1;
    font-size: 12px;
  }
`

const Alert = styled.div<{ type: 'info' | 'warning' | 'error' | 'success' }>`
  padding: 10px 15px;
  border-radius: 4px;
  margin-bottom: 16px;
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

const BrowserTip = styled.div`
  font-size: 12px;
  color: var(--color-text-3);
  margin-top: 8px;
`

export default ASRSettings
