import { Tooltip } from '@cherrystudio/ui'
import { NavbarHeader } from '@renderer/components/app/Navbar'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useShowAssistants } from '@renderer/hooks/useStore'
import { t } from 'i18next'
import { PanelLeftClose, PanelRightClose } from 'lucide-react'
import type { FC } from 'react'

import NavbarIcon from '../../../../components/NavbarIcon'
import ChatNavbarContent from './ChatNavbarContent'

interface Props {
  assistantId: string
}

const HeaderNavbar: FC<Props> = ({ assistantId }) => {
  const { showAssistants, toggleShowAssistants } = useShowAssistants()
  const { isTopNavbar } = useNavbarPosition()

  useShortcut('general.search', () => {
    void SearchPopup.show()
  })

  return (
    <NavbarHeader className="home-navbar" style={{ height: 'var(--navbar-height)' }}>
      <div className="flex h-full min-w-0 flex-1 shrink items-center overflow-auto">
        {isTopNavbar && showAssistants && (
          <Tooltip placement="bottom" content={t('navbar.hide_sidebar')} delay={800}>
            <NavbarIcon onClick={toggleShowAssistants}>
              <PanelLeftClose size={18} />
            </NavbarIcon>
          </Tooltip>
        )}
        {isTopNavbar && !showAssistants && (
          <Tooltip placement="bottom" content={t('navbar.show_sidebar')} delay={800}>
            <NavbarIcon onClick={() => toggleShowAssistants()} style={{ marginRight: 8 }}>
              <PanelRightClose size={18} />
            </NavbarIcon>
          </Tooltip>
        )}
        <ChatNavbarContent assistantId={assistantId} />
      </div>
    </NavbarHeader>
  )
}

export default HeaderNavbar
