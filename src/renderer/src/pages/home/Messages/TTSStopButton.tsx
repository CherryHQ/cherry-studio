import { SoundOutlined } from '@ant-design/icons'
import TTSService from '@renderer/services/TTSService'
import { Tooltip } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const TTSStopButton: React.FC = () => {
  const { t } = useTranslation()
  const [isVisible, setIsVisible] = useState(false)

  // 检查是否正在播放TTS
  useEffect(() => {
    const checkPlayingStatus = setInterval(() => {
      const isPlaying = TTSService.isCurrentlyPlaying()
      setIsVisible(isPlaying)
    }, 500)

    return () => clearInterval(checkPlayingStatus)
  }, [])

  // 停止TTS播放
  const handleStopTTS = useCallback(async () => {
    console.log('点击全局停止TTS按钮')

    // 强制停止所有TTS播放
    TTSService.stop()

    // 等待一下，确保播放已经完全停止
    await new Promise((resolve) => setTimeout(resolve, 100))

    // 再次检查并停止，确保强制停止
    if (TTSService.isCurrentlyPlaying()) {
      console.log('第一次停止未成功，再次尝试')
      TTSService.stop()
    }

    // 立即隐藏按钮
    setIsVisible(false)

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
