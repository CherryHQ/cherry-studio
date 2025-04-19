import { RootState } from '@renderer/store'
import React, { useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

interface TTSProgressBarProps {
  messageId: string
}

interface TTSProgressState {
  isPlaying: boolean
  progress: number // 0-100
  currentTime: number
  duration: number
}

const TTSProgressBar: React.FC<TTSProgressBarProps> = ({ messageId }) => {
  // 获取是否显示TTS进度条的设置
  const showTTSProgressBar = useSelector((state: RootState) => state.settings.showTTSProgressBar)

  const [progressState, setProgressState] = useState<TTSProgressState>({
    isPlaying: false,
    progress: 0,
    currentTime: 0,
    duration: 0
  })

  // 添加拖动状态
  const [isDragging, setIsDragging] = useState(false)

  // 监听TTS进度更新事件
  useEffect(() => {
    const handleProgressUpdate = (event: CustomEvent) => {
      const { messageId: playingMessageId, isPlaying, progress, currentTime, duration } = event.detail

      // 不需要每次都输出日志，避免控制台刷屏
      // 只在进度变化较大时输出日志，或者开始/结束时
      // 在拖动进度条时不输出日志
      // 完全关闭进度更新日志输出
      // if (!isDragging &&
      //     playingMessageId === messageId &&
      //     (
      //       // 开始或结束播放
      //       (isPlaying !== progressState.isPlaying) ||
      //       // 每10%输出一次日志
      //       (Math.floor(progress / 10) !== Math.floor(progressState.progress / 10))
      //     )
      // ) {
      //   console.log('TTS进度更新:', {
      //     messageId: messageId.substring(0, 8),
      //     isPlaying,
      //     progress: Math.round(progress),
      //     currentTime: Math.round(currentTime),
      //     duration: Math.round(duration)
      //   })
      // }

      // 只有当前消息正在播放时才更新进度
      // 增加对playingMessageId的检查，确保它存在且不为空
      // 这样在语音通话模式下的开场白不会显示进度条
      if (playingMessageId && playingMessageId === messageId) {
        // 如果收到的是重置信号（duration为0），则强制设置为非播放状态
        if (duration === 0 && currentTime === 0 && progress === 0) {
          setProgressState({
            isPlaying: false,
            progress: 0,
            currentTime: 0,
            duration: 0
          })
        } else {
          setProgressState({ isPlaying, progress, currentTime, duration })
        }
      } else if (progressState.isPlaying) {
        // 如果当前消息不是正在播放的消息，但状态显示正在播放，则重置状态
        setProgressState({
          isPlaying: false,
          progress: 0,
          currentTime: 0,
          duration: 0
        })
      }
    }

    // 监听TTS状态变化事件
    const handleStateChange = (event: CustomEvent) => {
      const { isPlaying } = event.detail

      // 如果停止播放，重置进度条状态
      if (!isPlaying && progressState.isPlaying) {
        // console.log('收到TTS停止播放事件，重置进度条')
        setProgressState({
          isPlaying: false,
          progress: 0,
          currentTime: 0,
          duration: 0
        })
      }
    }

    // 添加事件监听器
    window.addEventListener('tts-progress-update', handleProgressUpdate as EventListener)
    window.addEventListener('tts-state-change', handleStateChange as EventListener)

    // console.log('添加TTS进度更新事件监听器，消息ID:', messageId)

    // 组件卸载时移除事件监听器
    return () => {
      window.removeEventListener('tts-progress-update', handleProgressUpdate as EventListener)
      window.removeEventListener('tts-state-change', handleStateChange as EventListener)
      // console.log('移除TTS进度更新事件监听器，消息ID:', messageId)
    }
  }, [messageId, progressState.isPlaying, isDragging])

  // 如果没有播放或者设置为不显示进度条，则不显示
  if (!progressState.isPlaying || !showTTSProgressBar) {
    return null
  }

  // 处理进度条点击
  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressState.isPlaying) return

    // 如果是拖动结束的点击事件，忽略
    if (e.type === 'click' && e.detail === 0) return

    const trackRect = e.currentTarget.getBoundingClientRect()
    const clickPosition = e.clientX - trackRect.left
    const trackWidth = trackRect.width
    const seekPercentage = (clickPosition / trackWidth) * 100
    const seekTime = (seekPercentage / 100) * progressState.duration

    // console.log(`进度条点击: ${seekPercentage.toFixed(2)}%, 时间: ${seekTime.toFixed(2)}秒`)

    // 调用TTS服务的seek方法
    import('@renderer/services/TTSService').then(({ default: TTSService }) => {
      TTSService.seek(seekTime)
    })
  }

  // 处理拖动
  const handleDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressState.isPlaying) return
    e.preventDefault()
    e.stopPropagation() // 阻止事件冒泡

    // 设置拖动状态为true
    setIsDragging(true)

    const trackRect = e.currentTarget.getBoundingClientRect()
    const trackWidth = trackRect.width

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDragging) return

      moveEvent.preventDefault()
      const dragPosition = Math.max(0, Math.min(moveEvent.clientX - trackRect.left, trackWidth))
      const seekPercentage = (dragPosition / trackWidth) * 100
      const seekTime = (seekPercentage / 100) * progressState.duration

      // 更新本地状态以实时反映拖动位置
      setProgressState((prev) => ({
        ...prev,
        progress: seekPercentage,
        currentTime: seekTime
      }))
    }

    const handleMouseUp = (upEvent: MouseEvent) => {
      if (!isDragging) return

      // 设置拖动状态为false
      setIsDragging(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)

      const dragPosition = Math.max(0, Math.min(upEvent.clientX - trackRect.left, trackWidth))
      const seekPercentage = (dragPosition / trackWidth) * 100
      const seekTime = (seekPercentage / 100) * progressState.duration

      // console.log(`拖动结束: ${seekPercentage.toFixed(2)}%, 时间: ${seekTime.toFixed(2)}秒`)

      // 调用TTS服务的seek方法
      import('@renderer/services/TTSService').then(({ default: TTSService }) => {
        TTSService.seek(seekTime)
      })
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  return (
    <ProgressBarContainer>
      <ProgressBarTrack onClick={handleTrackClick} onMouseDown={handleDrag}>
        <ProgressBarFill style={{ width: `${progressState.progress}%` }} />
        <ProgressBarHandle style={{ left: `${progressState.progress}%` }} />
      </ProgressBarTrack>
      <ProgressText>
        {formatTime(progressState.currentTime)} / {formatTime(progressState.duration)}
      </ProgressText>
    </ProgressBarContainer>
  )
}

// 格式化时间为 mm:ss 格式
const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

const ProgressBarContainer = styled.div`
  margin-top: 8px;
  margin-bottom: 8px;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
`

const ProgressBarTrack = styled.div`
  width: 100%;
  height: 8px;
  background-color: var(--color-background-mute);
  border-radius: 4px;
  overflow: visible;
  position: relative;
  cursor: pointer;
`

const ProgressBarFill = styled.div`
  height: 100%;
  background-color: var(--color-primary);
  border-radius: 4px;
  transition: width 0.1s linear;
  pointer-events: none;
`

const ProgressBarHandle = styled.div`
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 12px;
  height: 12px;
  background-color: var(--color-primary);
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.2);
  z-index: 1;
  opacity: 0;
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
  pointer-events: none;

  ${ProgressBarTrack}:hover & {
    opacity: 1;
  }
`

const ProgressText = styled.div`
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-text-2);
`

export default TTSProgressBar
