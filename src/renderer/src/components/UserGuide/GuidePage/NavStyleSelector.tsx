import layoutNav from '@renderer/assets/images/guide/layout_nav.png'
import layoutNavDark from '@renderer/assets/images/guide/layout_nav_dark.png'
import layoutSide from '@renderer/assets/images/guide/layout_side.png'
import layoutSideDark from '@renderer/assets/images/guide/layout_side_dark.png'
import { useTheme } from '@renderer/context/ThemeProvider'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { NavStyleLabel, NavStyleOption, NavStyleOptions, NavStylePreview } from './styles'

interface NavStyleSelectorProps {
  value: 'left' | 'top'
  onChange: (value: 'left' | 'top') => void
}

const NavStyleSelector: FC<NavStyleSelectorProps> = ({ value, onChange }) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <NavStyleOptions>
      <NavStyleOption $selected={value === 'left'} onClick={() => onChange('left')}>
        <NavStylePreview>
          <img src={isDark ? layoutSideDark : layoutSide} alt="Left sidebar" />
        </NavStylePreview>
        <NavStyleLabel>{t('userGuide.guidePage.navStyle.left')}</NavStyleLabel>
      </NavStyleOption>
      <NavStyleOption $selected={value === 'top'} onClick={() => onChange('top')}>
        <NavStylePreview>
          <img src={isDark ? layoutNavDark : layoutNav} alt="Top navigation" />
        </NavStylePreview>
        <NavStyleLabel>{t('userGuide.guidePage.navStyle.top')}</NavStyleLabel>
      </NavStyleOption>
    </NavStyleOptions>
  )
}

export default NavStyleSelector
