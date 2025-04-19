import {
  AudioMutedOutlined,
  AudioOutlined,
  CloseOutlined,
  DownOutlined,
  DragOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  SettingOutlined,
  SoundOutlined,
  UpOutlined
} from '@ant-design/icons'
import { Button, Space, Tooltip } from 'antd'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDispatch } from 'react-redux'
import styled from 'styled-components'

import { VoiceCallService } from '../services/VoiceCallService'
import { setIsVoiceCallActive, setLastPlayedMessageId, setSkipNextAutoTTS } from '../store/settings'
import VoiceVisualizer from './VoiceVisualizer'

interface Props {
  visible: boolean
  onClose: () => void
  position?: { x: number; y: number }
  onPositionChange?: (position: { x: number; y: number }) => void
}

// --- 样式组件 ---
const Container = styled.div`
  width: 300px;
  background-color: var(--color-background);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transform-origin: top left;
  will-change: transform;
  position: fixed;
  z-index: 1000;
  left: 0;
  top: 0;
  cursor: default;
`

const Header = styled.div`
  padding: 8px 12px;
  background-color: var(--color-primary);
  color: white;
  font-weight: bold;
  display: flex;
  align-items: center;
  cursor: move;
  user-select: none;
  position: relative;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 4px;
    background-color: rgba(255, 255, 255, 0.2);
  }

  &:hover::before {
    background-color: rgba(255, 255, 255, 0.4);
  }

  .drag-icon {
    margin-right: 8px; // DragOutlined 的样式
  }

  .settings-button {
    margin-left: auto; // 推到最右边
    color: white; // 设置按钮颜色
  }
`

const CloseButton = styled.div`
  margin-left: 8px; // 与设置按钮保持间距
  cursor: pointer;
`

const Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
`

const VisualizerContainer = styled.div`
  display: flex;
  justify-content: space-between;
  height: 60px;
`

const TranscriptContainer = styled.div`
  flex: 1;
  min-height: 60px;
  max-height: 100px;
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 8px;
  background-color: var(--color-background-2);
`

const TranscriptText = styled.div`
  margin-bottom: 8px;
`

const UserLabel = styled.span`
  font-weight: bold;
  color: var(--color-primary);
`

const ControlsContainer = styled.div`
  display: flex;
  justify-content: center;
  padding: 8px 0;
`

const RecordButton = styled(Button)`
  min-width: 120px;
`

// 设置面板的样式
const SettingsPanel = styled.div`
  margin-bottom: 10px;
  padding: 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
`

const SettingsTitle = styled.div`
  margin-bottom: 8px;
`

const ShortcutKeyButton = styled(Button)`
  min-width: 120px;
`

const SettingsTip = styled.div`
  margin-top: 8px;
  font-size: 12px;
  color: var(--color-text-secondary);
`
// --- 样式组件结束 ---

const DraggableVoiceCallWindow: React.FC<Props> = ({
  visible,
  onClose,
  position = { x: 20, y: 20 },
  onPositionChange
}) => {
  const { t } = useTranslation()
  const dispatch = useDispatch()
  const [isDragging, setIsDragging] = useState(false)
  const [currentPosition, setCurrentPosition] = useState(position)
  const dragStartRef = useRef<{ startX: number; startY: number; initialX: number; initialY: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // --- 语音通话状态 ---
  const [transcript, setTranscript] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  // --- 语音通话状态结束 ---

  // --- 快捷键相关状态 ---
  const [shortcutKey, setShortcutKey] = useState('Space')
  const [isShortcutPressed, setIsShortcutPressed] = useState(false)
  const [isSettingsVisible, setIsSettingsVisible] = useState(false)
  const [tempShortcutKey, setTempShortcutKey] = useState(shortcutKey)
  const [isRecordingShortcut, setIsRecordingShortcut] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(false)
  // --- 快捷键相关状态结束 ---

  const isInitializedRef = useRef(false)

  // --- 拖拽逻辑 ---
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('button, input, a')) {
        return
      }
      e.preventDefault()
      setIsDragging(true)
      dragStartRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        initialX: currentPosition.x,
        initialY: currentPosition.y
      }
    },
    [currentPosition]
  )

  const handleDrag = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !dragStartRef.current) return
      e.preventDefault()

      const deltaX = e.clientX - dragStartRef.current.startX
      const deltaY = e.clientY - dragStartRef.current.startY

      let newX = dragStartRef.current.initialX + deltaX
      let newY = dragStartRef.current.initialY + deltaY

      const windowWidth = window.innerWidth
      const windowHeight = window.innerHeight
      const containerWidth = containerRef.current?.offsetWidth || 300
      const containerHeight = containerRef.current?.offsetHeight || 300

      newX = Math.max(0, Math.min(newX, windowWidth - containerWidth))
      newY = Math.max(0, Math.min(newY, windowHeight - containerHeight))

      const newPosition = { x: newX, y: newY }
      setCurrentPosition(newPosition)
      onPositionChange?.(newPosition)
    },
    [isDragging, onPositionChange]
  )

  const handleDragEnd = useCallback(
    (e: MouseEvent) => {
      if (isDragging) {
        e.preventDefault()
        setIsDragging(false)
        dragStartRef.current = null
      }
    },
    [isDragging] // 移除了 currentPosition 依赖，因为它只在 handleDragStart 中读取一次
  )

  const throttle = useMemo(() => {
    let lastCall = 0
    const delay = 16 // ~60fps
    return (func: (e: MouseEvent) => void) => {
      return (e: MouseEvent) => {
        const now = new Date().getTime()
        if (now - lastCall < delay) {
          return
        }
        lastCall = now
        func(e)
      }
    }
  }, [])

  const throttledHandleDrag = useMemo(() => throttle(handleDrag), [handleDrag, throttle])

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', throttledHandleDrag)
      document.addEventListener('mouseup', handleDragEnd)
      document.body.style.cursor = 'move'
    } else {
      document.removeEventListener('mousemove', throttledHandleDrag)
      document.removeEventListener('mouseup', handleDragEnd)
      document.body.style.cursor = 'default'
    }
    return () => {
      document.removeEventListener('mousemove', throttledHandleDrag)
      document.removeEventListener('mouseup', handleDragEnd)
      document.body.style.cursor = 'default'
    }
  }, [isDragging, throttledHandleDrag, handleDragEnd])
  // --- 拖拽逻辑结束 ---

  // --- 状态和副作用管理 ---
  useEffect(() => {
    const handleTTSStateChange = (event: CustomEvent) => {
      const { isPlaying } = event.detail
      setIsSpeaking(isPlaying)
    }

    const startVoiceCall = async () => {
      try {
        window.message.loading({ content: t('voice_call.initializing'), key: 'voice-call-init' })
        try {
          await VoiceCallService.initialize()
        } catch (initError) {
          console.warn('语音识别服务初始化警告:', initError)
        }
        await VoiceCallService.startCall({
          onTranscript: setTranscript,
          onResponse: () => {
            /* 响应在聊天界面处理 */
          },
          onListeningStateChange: setIsListening,
          onSpeakingStateChange: setIsSpeaking
        })
        window.message.success({ content: t('voice_call.ready'), key: 'voice-call-init' })
        isInitializedRef.current = true
      } catch (error) {
        console.error('Voice call error:', error)
        window.message.error({ content: t('voice_call.error'), key: 'voice-call-init' })
        onClose()
      }
    }

    if (visible) {
      dispatch(setIsVoiceCallActive(true))
      dispatch(setLastPlayedMessageId(null))
      dispatch(setSkipNextAutoTTS(true))
      if (!isInitializedRef.current) {
        startVoiceCall()
      }
      window.addEventListener('tts-state-change', handleTTSStateChange as EventListener)
    } else if (!visible && isInitializedRef.current) {
      dispatch(setIsVoiceCallActive(false))
      dispatch(setSkipNextAutoTTS(false))
      VoiceCallService.endCall()
      setTranscript('')
      setIsListening(false)
      setIsSpeaking(false)
      setIsRecording(false)
      setIsProcessing(false)
      setIsPaused(false)
      setIsMuted(false)
      isInitializedRef.current = false
      window.removeEventListener('tts-state-change', handleTTSStateChange as EventListener)
    }

    return () => {
      window.removeEventListener('tts-state-change', handleTTSStateChange as EventListener)
    }
  }, [visible, dispatch, t, onClose])
  // --- 状态和副作用管理结束 ---

  // --- 语音通话控制函数 ---
  const toggleMute = useCallback(() => {
    const newMuteState = !isMuted
    setIsMuted(newMuteState)
    VoiceCallService.setMuted(newMuteState)
  }, [isMuted]) // 添加依赖

  const togglePause = useCallback(() => {
    const newPauseState = !isPaused
    setIsPaused(newPauseState)
    VoiceCallService.setPaused(newPauseState)
  }, [isPaused]) // 添加依赖

  // !! 将这些函数定义移到 handleKeyDown/handleKeyUp 之前 !!
  const handleRecordStart = useCallback(
    async (e: React.MouseEvent | React.TouchEvent | KeyboardEvent) => {
      e.preventDefault()
      if (isProcessing || isPaused) return
      setTranscript('')
      VoiceCallService.stopTTS()
      setIsSpeaking(false)
      setIsRecording(true)
      setIsProcessing(true)
      try {
        await VoiceCallService.startRecording()
        setIsProcessing(false)
      } catch (error) {
        window.message.error({ content: '启动语音识别失败，请确保语音识别服务已启动', key: 'voice-call-error' })
        setIsRecording(false)
        setIsProcessing(false)
      }
    },
    [isProcessing, isPaused]
  )

  const handleRecordEnd = useCallback(
    async (e: React.MouseEvent | React.TouchEvent | KeyboardEvent) => {
      e.preventDefault()
      if (!isRecording) return
      setIsRecording(false)
      setIsProcessing(true)
      VoiceCallService.stopTTS()
      setIsSpeaking(false)
      try {
        const success = await VoiceCallService.stopRecordingAndSendToChat()
        if (success) {
          window.message.success({ content: '语音识别已完成，正在发送消息...', key: 'voice-call-send' })
        } else {
          window.message.error({ content: '发送语音识别结果失败', key: 'voice-call-error' })
        }
      } catch (error) {
        window.message.error({ content: '停止录音出错', key: 'voice-call-error' })
      } finally {
        setTimeout(() => setIsProcessing(false), 500)
      }
    },
    [isRecording]
  )

  const handleRecordCancel = useCallback(
    async (e: React.MouseEvent | React.TouchEvent | KeyboardEvent) => {
      e.preventDefault()
      if (isRecording) {
        setIsRecording(false)
        setIsProcessing(true)
        VoiceCallService.stopTTS()
        setIsSpeaking(false)
        try {
          await VoiceCallService.cancelRecording()
          setTranscript('')
        } catch (error) {
          console.error('取消录音出错:', error)
        } finally {
          setTimeout(() => setIsProcessing(false), 500)
        }
      }
    },
    [isRecording]
  )
  // --- 语音通话控制函数结束 ---

  // --- 快捷键相关函数 ---
  const getKeyDisplayName = (keyCode: string) => {
    const keyMap: Record<string, string> = {
      Space: '空格键',
      Enter: '回车键',
      ShiftLeft: '左Shift键',
      ShiftRight: '右Shift键',
      ControlLeft: '左Ctrl键',
      ControlRight: '右Ctrl键',
      AltLeft: '左Alt键',
      AltRight: '右Alt键'
    }
    return keyMap[keyCode] || keyCode
  }

  const handleShortcutKeyChange = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault()
      if (isRecordingShortcut) {
        setTempShortcutKey(e.code)
        setIsRecordingShortcut(false)
      }
    },
    [isRecordingShortcut]
  )

  const saveShortcutKey = useCallback(() => {
    setShortcutKey(tempShortcutKey)
    localStorage.setItem('voiceCallShortcutKey', tempShortcutKey)
    setIsSettingsVisible(false)
  }, [tempShortcutKey])

  // 现在可以安全地使用 handleRecordStart/End
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (isRecordingShortcut) {
        handleShortcutKeyChange(e)
        return
      }
      if (e.code === shortcutKey && !isProcessing && !isPaused && visible && !isShortcutPressed) {
        e.preventDefault()
        setIsShortcutPressed(true)
        const mockEvent = new MouseEvent('mousedown') as unknown as React.MouseEvent // 类型断言
        handleRecordStart(mockEvent) // 现在 handleRecordStart 已经定义
      }
    },
    [
      shortcutKey,
      isProcessing,
      isPaused,
      visible,
      isShortcutPressed,
      handleRecordStart, // 依赖项
      isRecordingShortcut,
      handleShortcutKeyChange
    ]
  )

  const handleKeyUp = useCallback(
    (e: KeyboardEvent) => {
      if (e.code === shortcutKey && isShortcutPressed && visible) {
        e.preventDefault()
        setIsShortcutPressed(false)
        const mockEvent = new MouseEvent('mouseup') as unknown as React.MouseEvent // 类型断言
        handleRecordEnd(mockEvent) // 现在 handleRecordEnd 已经定义
      }
    },
    [shortcutKey, isShortcutPressed, visible, handleRecordEnd]
  ) // 依赖项

  useEffect(() => {
    const savedShortcut = localStorage.getItem('voiceCallShortcutKey')
    if (savedShortcut) {
      setShortcutKey(savedShortcut)
      setTempShortcutKey(savedShortcut)
    }
  }, [])

  useEffect(() => {
    if (visible) {
      window.addEventListener('keydown', handleKeyDown)
      window.addEventListener('keyup', handleKeyUp)
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [visible, handleKeyDown, handleKeyUp])
  // --- 快捷键相关函数结束 ---

  // 如果不可见，直接返回 null
  if (!visible) return null

  // --- JSX 渲染 ---
  return (
    <Container
      ref={containerRef}
      style={{
        transform: `translate(${currentPosition.x}px, ${currentPosition.y}px)` // 使用 transform 定位
      }}>
      {/* 将 onMouseDown 移到 Header 上 */}
      <Header onMouseDown={handleDragStart}>
        <DragOutlined className="drag-icon" /> {/* 应用样式类 */}
        {t('voice_call.title')}
        <Button
          type="text"
          icon={isCollapsed ? <DownOutlined /> : <UpOutlined />}
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="settings-button"
        />
        <Button
          type="text"
          icon={<SettingOutlined />}
          onClick={() => setIsSettingsVisible(!isSettingsVisible)}
          className="settings-button" // 应用样式类
        />
        <CloseButton onClick={onClose}>
          <CloseOutlined />
        </CloseButton>
      </Header>

      <Content>
        {!isCollapsed && (
          <>
            {isSettingsVisible && (
              <SettingsPanel>
                {' '}
                {/* 使用 styled-component */}
                <SettingsTitle>{t('voice_call.shortcut_key_setting')}</SettingsTitle> {/* 使用 styled-component */}
                <Space>
                  <ShortcutKeyButton onClick={() => setIsRecordingShortcut(true)}>
                    {' '}
                    {/* 使用 styled-component */}
                    {isRecordingShortcut ? t('voice_call.press_any_key') : getKeyDisplayName(tempShortcutKey)}
                  </ShortcutKeyButton>
                  <Button type="primary" onClick={saveShortcutKey}>
                    {t('voice_call.save')}
                  </Button>
                  <Button onClick={() => setIsSettingsVisible(false)}>{t('voice_call.cancel')}</Button>
                </Space>
                <SettingsTip>
                  {' '}
                  {/* 使用 styled-component */}
                  {t('voice_call.shortcut_key_tip')}
                </SettingsTip>
              </SettingsPanel>
            )}
            <VisualizerContainer>
              <VoiceVisualizer isActive={isListening || isRecording} type="input" />
              <VoiceVisualizer isActive={isSpeaking} type="output" />
            </VisualizerContainer>

            <TranscriptContainer>
              {transcript && (
                <TranscriptText>
                  <UserLabel>{t('voice_call.you')}:</UserLabel> {transcript}
                </TranscriptText>
              )}
              {/* 可以在这里添加 AI 回复的显示 */}
            </TranscriptContainer>
          </>
        )}

        <ControlsContainer>
          <Space>
            <Button
              type="text"
              icon={isMuted ? <AudioMutedOutlined /> : <AudioOutlined />}
              onClick={toggleMute}
              size="large"
              title={isMuted ? t('voice_call.unmute') : t('voice_call.mute')}
            />
            <Button
              type="text"
              icon={isPaused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
              onClick={togglePause}
              size="large"
              title={isPaused ? t('voice_call.resume') : t('voice_call.pause')}
            />
            <Tooltip title={`${t('voice_call.press_to_talk')} (${getKeyDisplayName(shortcutKey)})`}>
              <RecordButton
                type={isRecording ? 'primary' : 'default'}
                icon={<SoundOutlined />}
                onMouseDown={handleRecordStart}
                onMouseUp={handleRecordEnd}
                onMouseLeave={handleRecordCancel}
                onTouchStart={handleRecordStart}
                onTouchEnd={handleRecordEnd}
                onTouchCancel={handleRecordCancel}
                size="large"
                disabled={isProcessing || isPaused}>
                {isRecording ? t('voice_call.release_to_send') : t('voice_call.press_to_talk')}
              </RecordButton>
            </Tooltip>
          </Space>
        </ControlsContainer>
      </Content>
    </Container>
  )
}

export default DraggableVoiceCallWindow
