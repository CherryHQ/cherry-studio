import { isLinux, isWin } from '@renderer/config/constant'
import { Tooltip } from 'antd'
import { Minus, Square, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { SVGProps } from 'react'
import { useTranslation } from 'react-i18next'

import { ControlButton, WindowControlsContainer } from './WindowControls.styled'

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
    <rect
      width="14.165795"
      height="14.165795"
      x="2.7646871"
      y="7.0695167"
      rx="1.2377932"
      id="rect2"
      style={{ strokeWidth: '1.57397' }}
    />
    <path
      d="m 8.8907777,2.8269172 c -0.5045461,0 -0.9490675,0.2424833 -1.2285866,0.6160739 H 18.993677 c 0.866756,0 1.563332,0.696576 1.563332,1.5633319 v 11.331486 c 0.37359,-0.279519 0.616074,-0.72404 0.616074,-1.228587 V 4.3635407 c 0,-0.8505156 -0.686108,-1.5366235 -1.536624,-1.5366235 z"
      style={{ strokeWidth: '0.911647', strokeDasharray: 'none' }}
      id="path5"
    />
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
