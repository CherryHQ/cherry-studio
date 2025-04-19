import { LoadingOutlined, PhoneOutlined } from '@ant-design/icons'
import { Button, Tooltip } from 'antd'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { VoiceCallService } from '../services/VoiceCallService'
import DraggableVoiceCallWindow from './DraggableVoiceCallWindow'

interface Props {
  disabled?: boolean
  style?: React.CSSProperties
}

const VoiceCallButton: React.FC<Props> = ({ disabled = false, style }) => {
  const { t } = useTranslation()
  const [isWindowVisible, setIsWindowVisible] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [windowPosition, setWindowPosition] = useState({ x: 20, y: 20 })

  const handleClick = async () => {
    if (disabled || isLoading) return

    setIsLoading(true)
    try {
      // 初始化语音服务
      await VoiceCallService.initialize()
      // 先设置窗口可见，然后在DraggableVoiceCallWindow组件中处理状态更新
      setIsWindowVisible(true)
      // 注意：不在这里调用dispatch，而是在DraggableVoiceCallWindow组件中处理
    } catch (error) {
      console.error('Failed to initialize voice call:', error)
      window.message.error(t('voice_call.initialization_failed'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <Tooltip title={t('voice_call.start')}>
        <Button
          type="text"
          icon={isLoading ? <LoadingOutlined /> : <PhoneOutlined />}
          onClick={handleClick}
          disabled={disabled || isLoading}
          style={style}
        />
      </Tooltip>
      <DraggableVoiceCallWindow
        visible={isWindowVisible}
        onClose={() => {
          setIsWindowVisible(false)
          // 注意：不在这里调用dispatch，而是在DraggableVoiceCallWindow组件中处理
        }}
        position={windowPosition}
        onPositionChange={setWindowPosition}
      />
    </>
  )
}

export default VoiceCallButton
