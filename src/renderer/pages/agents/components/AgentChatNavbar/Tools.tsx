import { CommandTooltip } from '@renderer/components/command'
import GlobalSearchPopup from '@renderer/components/GlobalSearch/GlobalSearchPopup'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  children?: ReactNode
}

const Tools = ({ children }: Props) => {
  const { t } = useTranslation()
  const searchLabel = t('globalSearch.open')

  const openGlobalSearch = () => {
    void GlobalSearchPopup.show()
  }

  return (
    <div className="flex items-center gap-0.5">
      {children}
      <CommandTooltip command="app.search" label={searchLabel} placement="bottom" delay={800}>
        <NavbarIcon tone="conversation" aria-label={searchLabel} onClick={openGlobalSearch}>
          <Search size={16} strokeWidth={1.8} />
        </NavbarIcon>
      </CommandTooltip>
    </div>
  )
}

export default Tools
