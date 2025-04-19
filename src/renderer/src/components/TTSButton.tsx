import { SoundOutlined } from '@ant-design/icons'
import TTSService from '@renderer/services/TTSService'
import { Message } from '@renderer/types'
import { Tooltip } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface TTSButtonProps {
  message: Message
  className?: string
}

interface SegmentedPlaybackState {
  isSegmentedPlayback: boolean
  segments: {
    text: string
    isLoaded: boolean
    isLoading: boolean
  }[]
  currentSegmentIndex: number
  isPlaying: boolean
}

const TTSButton: React.FC<TTSButtonProps> = ({ message, className }) => {
  const { t } = useTranslation()
  const [isSpeaking, setIsSpeaking] = useState(false)
  // 分段播放状态
  const [, setSegmentedPlaybackState] = useState<SegmentedPlaybackState>({
    isSegmentedPlayback: false,
    segments: [],
    currentSegmentIndex: 0,
    isPlaying: false
  })

  // 添加TTS状态变化事件监听器
  useEffect(() => {
    const handleTTSStateChange = (event: CustomEvent) => {
      const { isPlaying } = event.detail
      console.log('TTS按钮检测到TTS状态变化:', isPlaying)
      setIsSpeaking(isPlaying)
    }

    // 添加事件监听器
    window.addEventListener('tts-state-change', handleTTSStateChange as EventListener)

    // 组件卸载时移除事件监听器
    return () => {
      window.removeEventListener('tts-state-change', handleTTSStateChange as EventListener)
    }
  }, [])

  // 监听分段播放状态变化
  useEffect(() => {
    const handleSegmentedPlaybackUpdate = (event: CustomEvent) => {
      console.log('检测到分段播放状态更新:', event.detail)
      setSegmentedPlaybackState(event.detail)
    }

    // 添加事件监听器
    window.addEventListener('tts-segmented-playback-update', handleSegmentedPlaybackUpdate as EventListener)

    // 组件卸载时移除事件监听器
    return () => {
      window.removeEventListener('tts-segmented-playback-update', handleSegmentedPlaybackUpdate as EventListener)
    }
  }, [])

  // 初始化时检查TTS状态
  useEffect(() => {
    // 检查当前是否正在播放
    const isCurrentlyPlaying = TTSService.isCurrentlyPlaying()
    if (isCurrentlyPlaying !== isSpeaking) {
      setIsSpeaking(isCurrentlyPlaying)
    }
  }, [isSpeaking])

  const handleTTS = useCallback(async () => {
    if (isSpeaking) {
      TTSService.stop()
      return // 不需要手动设置状态，事件监听器会处理
    }

    try {
      console.log('点击TTS按钮，开始播放消息')
      await TTSService.speakFromMessage(message)
      // 不需要手动设置状态，事件监听器会处理
    } catch (error) {
      console.error('TTS error:', error)
      // 出错时才需要手动重置状态
      setIsSpeaking(false)
    }
  }, [isSpeaking, message])

  // 处理分段播放按钮点击 - 暂未使用，保留供未来扩展
  /* const handleSegmentedTTS = useCallback(async () => {
    try {
      console.log('点击分段TTS按钮，开始分段播放消息')
      // 使用修改后的speakFromMessage方法，传入segmented=true参数
      await TTSService.speakFromMessage(message, true)
    } catch (error) {
      console.error('Segmented TTS error:', error)
    }
  }, [message]) */

  return (
    <Tooltip title={isSpeaking ? t('chat.tts.stop') : t('chat.tts.play')}>
      <TTSActionButton className={className} onClick={handleTTS}>
        <SoundOutlined style={{ color: isSpeaking ? 'var(--color-primary)' : 'var(--color-icon)' }} />
      </TTSActionButton>
    </Tooltip>
  )
}

const TTSActionButton = styled.div`
  cursor: pointer;
  border-radius: 8px;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  width: 30px;
  height: 30px;
  transition: all 0.2s ease;
  &:hover {
    background-color: var(--color-background-mute);
    .anticon {
      color: var(--color-text-1);
    }
  }
  .anticon,
  .iconfont {
    cursor: pointer;
    font-size: 14px;
    color: var(--color-icon);
  }
  &:hover {
    color: var(--color-text-1);
  }
`

export default TTSButton
