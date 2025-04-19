import { AudioOutlined, LoadingOutlined } from '@ant-design/icons'
import { useSettings } from '@renderer/hooks/useSettings'
import ASRService from '@renderer/services/ASRService'
import { Button, Tooltip } from 'antd'
import { FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  onTranscribed: (text: string, isFinal?: boolean) => void
  disabled?: boolean
  style?: React.CSSProperties
}

const ASRButton: FC<Props> = ({ onTranscribed, disabled = false, style }) => {
  const { t } = useTranslation()
  const { asrEnabled } = useSettings()
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [isCountingDown, setIsCountingDown] = useState(false)

  const handleASR = useCallback(async () => {
    if (!asrEnabled) {
      window.message.error({ content: t('settings.asr.error.not_enabled'), key: 'asr-error' })
      return
    }

    if (isRecording) {
      // 停止录音并处理
      setIsRecording(false)
      setIsProcessing(true)
      try {
        // 添加事件监听器，监听服务器发送的stopped消息
        const originalCallback = ASRService.resultCallback
        const stopCallback = (text: string) => {
          // 如果是空字符串，只重置状态，不调用原始回调
          if (text === '') {
            setIsProcessing(false)
            return
          }

          // 否则调用原始回调并重置状态
          if (originalCallback) originalCallback(text)
          setIsProcessing(false)
        }

        await ASRService.stopRecording(stopCallback)
      } catch (error) {
        console.error('ASR error:', error)
        setIsProcessing(false)
      }
    } else {
      // 开始录音
      // 显示3秒倒计时，同时立即开始录音
      setIsCountingDown(true)
      setCountdown(3)
      setIsRecording(true)

      // 立即发送开始信号
      try {
        await ASRService.startRecording(onTranscribed)
      } catch (error) {
        console.error('Failed to start recording:', error)
        setIsRecording(false)
        setIsCountingDown(false)
        return
      }

      // 倒计时结束后只隐藏倒计时显示
      setTimeout(() => {
        setIsCountingDown(false)
      }, 3000) // 3秒倒计时
    }
  }, [asrEnabled, isRecording, onTranscribed, t])

  const handleCancel = useCallback(() => {
    if (isCountingDown) {
      // 如果在倒计时中，取消倒计时和录音
      setIsCountingDown(false)
      setCountdown(0)
      // 同时取消录音，因为录音已经开始
      ASRService.cancelRecording()
      setIsRecording(false)
    } else if (isRecording) {
      // 如果已经在录音，取消录音
      ASRService.cancelRecording()
      setIsRecording(false)
    }
  }, [isRecording, isCountingDown])

  // 倒计时效果
  useEffect(() => {
    if (isCountingDown && countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown(countdown - 1)
      }, 1000)
      return () => clearTimeout(timer)
    }
    return undefined // 添加返回值以解决TS7030错误
  }, [countdown, isCountingDown])

  if (!asrEnabled) {
    return null
  }

  return (
    <Tooltip
      title={
        isRecording
          ? t('settings.asr.stop')
          : isCountingDown
            ? `${t('settings.asr.preparing')} (${countdown})`
            : t('settings.asr.start')
      }>
      <ButtonWrapper>
        <StyledButton
          type={isRecording || isCountingDown ? 'primary' : 'default'}
          icon={isProcessing ? <LoadingOutlined /> : isCountingDown ? null : <AudioOutlined />}
          onClick={handleASR}
          onDoubleClick={handleCancel}
          disabled={disabled || isProcessing || (isCountingDown && countdown > 0)}
          style={style}
          className={isCountingDown ? 'counting-down' : ''}>
          {isCountingDown && <CountdownNumber>{countdown}</CountdownNumber>}
        </StyledButton>
        {isCountingDown && (
          <CountdownIndicator>
            {t('settings.asr.preparing')} ({countdown})
          </CountdownIndicator>
        )}
      </ButtonWrapper>
    </Tooltip>
  )
}

const ButtonWrapper = styled.div`
  position: relative;
  display: inline-block;
`

const CountdownIndicator = styled.div`
  position: absolute;
  top: -25px;
  left: 50%;
  transform: translateX(-50%);
  background-color: var(--color-primary);
  color: white;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 12px;
  white-space: nowrap;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
  animation: pulse 1s infinite;
  z-index: 10;

  @keyframes pulse {
    0% {
      opacity: 0.7;
    }
    50% {
      opacity: 1;
    }
    100% {
      opacity: 0.7;
    }
  }

  &:after {
    content: '';
    position: absolute;
    bottom: -5px;
    left: 50%;
    transform: translateX(-50%);
    width: 0;
    height: 0;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-top: 5px solid var(--color-primary);
  }
`

const CountdownNumber = styled.span`
  font-size: 18px;
  font-weight: bold;
  animation: zoom 1s infinite;

  @keyframes zoom {
    0% {
      transform: scale(0.8);
    }
    50% {
      transform: scale(1.2);
    }
    100% {
      transform: scale(0.8);
    }
  }
`

const StyledButton = styled(Button)`
  min-width: 30px;
  height: 30px;
  font-size: 16px;
  border-radius: 50%;
  transition: all 0.3s ease;
  color: var(--color-icon);
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  padding: 0;
  border: none; /* 移除边框 */
  &.anticon,
  &.iconfont {
    transition: all 0.3s ease;
    color: var(--color-icon);
  }
  &:hover {
    background-color: var(--color-background-soft);
    .anticon,
    .iconfont {
      color: var(--color-text-1);
    }
  }
  &.active {
    background-color: var(--color-primary) !important;
    .anticon,
    .iconfont {
      color: var(--color-white-soft);
    }
    &:hover {
      background-color: var(--color-primary);
    }
  }
  &.counting-down {
    font-weight: bold;
    background-color: var(--color-primary);
    color: var(--color-white-soft);
  }
`

export default ASRButton
