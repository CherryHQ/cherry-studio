import { useTheme } from '@renderer/context/ThemeProvider'
import { FC } from 'react'

import { SettingContainer } from '..'
import PreprocessSettings from './PreprocessSettings'

const DocProcessSettings: FC = () => {
  const { theme: themeMode } = useTheme()

  return (
    <SettingContainer theme={themeMode}>
      <PreprocessSettings />
    </SettingContainer>
  )
}
export default DocProcessSettings
