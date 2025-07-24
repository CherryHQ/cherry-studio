import { Progress } from 'antd'
import React, { useEffect, useState } from 'react'
import styled from 'styled-components'

const ProgressBarContainer = styled.div<{ $isVisible: boolean }>`
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 3px; /* 高度可以根据需要调整 */
  z-index: 1000;
  opacity: ${(props) => (props.$isVisible ? 1 : 0)};
  transition: opacity 0.3s ease-in-out;
  pointer-events: none; /* 确保进度条不阻碍鼠标事件 */

  .ant-progress-outer {
    padding-right: 0px;
  }

  .ant-progress-inner {
    background-color: var(--color-background-soft);
    border-radius: 0;
  }

  .ant-progress-bg {
    background-color: var(--color-primary);
    border-radius: 0;
  }

  .ant-progress-success-bg {
    background-color: var(--color-primary);
  }
`

const ProgressBar: React.FC = () => {
  const [progress, setProgress] = useState(0)
  const [isVisible, setIsVisible] = useState(false)
  const [timerId, setTimerId] = useState<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const handleProgress = (_event: Electron.IpcRendererEvent, value: number) => {
      const percentage = Math.round(value * 100)
      setProgress(percentage)
      setIsVisible(true)

      // Clear any existing timer
      if (timerId) {
        clearTimeout(timerId)
      }

      // If progress is 100%, hide after a short delay
      if (percentage >= 100) {
        const newTimerId = setTimeout(() => {
          setIsVisible(false)
          setProgress(0)
        }, 500) // Hide after 0.5 seconds
        setTimerId(newTimerId)
      } else if (percentage === 0) {
        // If progress is 0, hide immediately
        setIsVisible(false)
      }
    }

    window.electron.ipcRenderer.on('mcp-progress', handleProgress)

    return () => {
      if (timerId) {
        clearTimeout(timerId)
      }
    }
  }, [timerId])

  return (
    <ProgressBarContainer $isVisible={isVisible}>
      <Progress percent={progress} showInfo={false} size="small" strokeWidth={3} />
    </ProgressBarContainer>
  )
}

export default ProgressBar
