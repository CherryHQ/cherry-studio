import { SoundOutlined } from '@ant-design/icons'
import TTSService from '@renderer/services/TTSService'
import { Tooltip } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const TTSStopButton: React.FC = () => {
  const { t } = useTranslation()
  const [isVisible, setIsVisible] = useState(false)

  // 添加TTS状态变化事件监听器
  useEffect(() => {
    const handleTTSStateChange = (event: CustomEvent) => {
      const { isPlaying } = event.detail
      console.log('全局TTS停止按钮检测到TTS状态变化:', isPlaying)
      setIsVisible(isPlaying)
    }

    // 添加事件监听器
    window.addEventListener('tts-state-change', handleTTSStateChange as EventListener)

    // 初始检查当前状态
    const isCurrentlyPlaying = TTSService.isCurrentlyPlaying()
    setIsVisible(isCurrentlyPlaying)

    // 组件卸载时移除事件监听器
    return () => {
      window.removeEventListener('tts-state-change', handleTTSStateChange as EventListener)
    }
  }, [])

  // 停止TTS播放
  const handleStopTTS = useCallback(async () => {
    console.log('点击全局停止TTS按钮')

    // 强制停止所有TTS播放
    TTSService.stop()

    // 不需要手动设置状态，事件监听器会处理

    // 显示停止消息
    window.message.success({ content: t('chat.tts.stopped', { defaultValue: '已停止语音播放' }), key: 'tts-stopped' })
  }, [t])

  if (!isVisible) return null

  return (
    <StopButtonContainer>
      <Tooltip title={t('chat.tts.stop_global')}>
        <ActionButton onClick={handleStopTTS}>
          <SoundOutlined />
        </ActionButton>
      </Tooltip>
    </StopButtonContainer>
  )
}

const StopButtonContainer = styled.div`
  position: fixed;
  bottom: 150px; /* 从100px改为150px，向上移动50px */
  right: 20px;
  z-index: 1000;
`

const ActionButton = styled.div`
  cursor: pointer;
  border-radius: 8px;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  width: 30px;
  height: 30px;
  transition: all 0.2s ease;
  background-color: var(--color-primary);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  &:hover {
    background-color: var(--color-primary-soft);
  }
  .anticon {
    cursor: pointer;
    font-size: 14px;
    color: var(--color-white);
  }
`

export default TTSStopButton
