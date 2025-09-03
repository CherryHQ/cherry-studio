import { isLinux, isWin } from '@renderer/config/constant'
import { Minus, Square, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { ControlButton, WindowControlsContainer } from './WindowControls.styled'

// Custom restore icon - two overlapping squares like Windows
const RestoreIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1">
    {/* Back square (top-right) */}
    <path d="M 4 2 H 11 V 9 H 9 V 4 H 4 V 2" />
    {/* Front square (bottom-left) */}
    <rect x="2" y="4" width="7" height="7" />
  </svg>
)

const WindowControls: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    // Check initial maximized state
    window.api.windowControls.isMaximized().then(setIsMaximized)

    // Listen for maximized state changes
    const unsubscribe = window.api.windowControls.onMaximizedChange(setIsMaximized)

    return () => {
      unsubscribe()
    }
  }, [])

  // Only show on Windows and Linux
  if (!isWin && !isLinux) {
    return null
  }

  const handleMinimize = () => {
    window.api.windowControls.minimize()
  }

  const handleMaximize = () => {
    if (isMaximized) {
      window.api.windowControls.unmaximize()
    } else {
      window.api.windowControls.maximize()
    }
  }

  const handleClose = () => {
    window.api.windowControls.close()
  }

  return (
    <WindowControlsContainer>
      <ControlButton onClick={handleMinimize} aria-label="Minimize">
        <Minus size={14} />
      </ControlButton>
      <ControlButton onClick={handleMaximize} aria-label={isMaximized ? 'Restore' : 'Maximize'}>
        {isMaximized ? <RestoreIcon size={14} /> : <Square size={14} />}
      </ControlButton>
      <ControlButton $isClose onClick={handleClose} aria-label="Close">
        <X size={17} />
      </ControlButton>
    </WindowControlsContainer>
  )
}

export default WindowControls