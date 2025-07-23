import { useShortcut } from '@renderer/hooks/useShortcuts'
import { Tooltip } from 'antd'
import { t } from 'i18next'
import { Pin, PinOff } from 'lucide-react'
import { FC, useCallback, useState } from 'react'
import styled from 'styled-components'

import { NavbarIcon } from '../Navbar'

interface PinButtonProps {
  initialPinned?: boolean
}

const PinButton: FC<PinButtonProps> = ({ initialPinned = false }) => {
  const [isPinned, setIsPinned] = useState(initialPinned)

  const handlePinWindow = useCallback(() => {
    window.api.mainWindow.setPin(!isPinned).then(() => {
      setIsPinned(!isPinned)
    })
  }, [isPinned])

  // 使用快捷键来切换窗口置顶状态
  useShortcut('pin_window', handlePinWindow)

  return (
    <Tooltip title={t('miniwindow.tooltip.pin')} mouseEnterDelay={0.8} placement="right">
      <PinButtonArea onClick={handlePinWindow}>
        {isPinned ? <Pin size={18} color="var(--color-primary)" /> : <PinOff size={18} />}
      </PinButtonArea>
    </Tooltip>
  )
}

const PinButtonArea = styled(NavbarIcon)`
  cursor: pointer;
  display: flex;
  align-items: center;
`

export default PinButton
