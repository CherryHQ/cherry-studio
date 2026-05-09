import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { NavbarHeader } from '@renderer/components/app/Navbar'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { t } from 'i18next'
import { PanelLeftClose, PanelRightClose } from 'lucide-react'
import type { FC } from 'react'

import NavbarIcon from '../../../../components/NavbarIcon'
import ChatNavbarContent from './ChatNavbarContent'

interface Props {
  assistantId: string
  topicId: string
}

const HeaderNavbar: FC<Props> = ({ assistantId, topicId }) => {
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const toggleShowSidebar = () => void setShowSidebar(!showSidebar)
  const { isTopNavbar } = useNavbarPosition()

  useShortcut('general.search', () => {
    void SearchPopup.show()
  })

  return (
    <NavbarHeader className="home-navbar" style={{ height: 'var(--navbar-height)' }}>
      <div className="flex h-full min-w-0 flex-1 shrink items-center overflow-auto">
        {isTopNavbar && showSidebar && (
          <Tooltip placement="bottom" content={t('navbar.hide_sidebar')} delay={800}>
            <NavbarIcon onClick={toggleShowSidebar}>
              <PanelLeftClose size={18} />
            </NavbarIcon>
          </Tooltip>
        )}
        {isTopNavbar && !showSidebar && (
          <Tooltip placement="bottom" content={t('navbar.show_sidebar')} delay={800}>
            <NavbarIcon onClick={toggleShowSidebar} style={{ marginRight: 8 }}>
              <PanelRightClose size={18} />
            </NavbarIcon>
          </Tooltip>
        )}
        <ChatNavbarContent assistantId={assistantId} topicId={topicId} />
      </div>
    </NavbarHeader>
  )
}

export default HeaderNavbar
