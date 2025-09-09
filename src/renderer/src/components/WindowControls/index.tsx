import { isLinux, isWin } from '@renderer/config/constant'
import { Tooltip } from 'antd'
import { Minus, Square, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ControlButton, WindowControlsContainer } from './WindowControls.styled'

import { SVGProps } from 'react'

interface WindowRestoreIconProps extends SVGProps<SVGSVGElement> {
  size?: string | number
}

export const WindowRestoreIcon = ({ size = '1.1em', ...props }: WindowRestoreIconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="lucide lucide-square-icon lucide-square"
    version="1.1"
    id="svg4"
    xmlns="http://www.w3.org/2000/svg"
    {...props}>
    <defs id="defs1" />
    {/* Back window - L shape with rounded corner */}
    <path d="M 8 5 L 17 5 Q 19 5 19 7 L 19 16" fill="none" style={{ strokeWidth: '1.75' }} id="path1" />
    {/* Front window - rounded rectangle */}
    <rect width="12" height="12" x="4" y="9" rx="2" ry="2" id="rect2" style={{ strokeWidth: '1.75' }} />
  </svg>
)

const DEFAULT_DELAY = 1

const WindowControls: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState(false)
  const { t } = useTranslation()

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
      <Tooltip title={t('navbar.window.minimize')} placement="bottom" mouseEnterDelay={DEFAULT_DELAY}>
        <ControlButton onClick={handleMinimize} aria-label="Minimize">
          <Minus size={14} />
        </ControlButton>
      </Tooltip>
      <Tooltip
        title={isMaximized ? t('navbar.window.restore') : t('navbar.window.maximize')}
        placement="bottom"
        mouseEnterDelay={DEFAULT_DELAY}>
        <ControlButton onClick={handleMaximize} aria-label={isMaximized ? 'Restore' : 'Maximize'}>
          {isMaximized ? <WindowRestoreIcon size={14} /> : <Square size={14} />}
        </ControlButton>
      </Tooltip>
      <Tooltip title={t('navbar.window.close')} placement="bottom" mouseEnterDelay={DEFAULT_DELAY}>
        <ControlButton $isClose onClick={handleClose} aria-label="Close">
          <X size={17} />
        </ControlButton>
      </Tooltip>
    </WindowControlsContainer>
  )
}

export default WindowControls
