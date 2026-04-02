import { useTheme } from '@renderer/context/ThemeProvider'
import type { FC } from 'react'

import { SettingContainer } from '.'
import FileProcessingTestPanel from './DocProcessSettings/FileProcessingTestPanel'

const DocProcessTestSettings: FC = () => {
  const { theme: themeMode } = useTheme()

  return (
    <SettingContainer theme={themeMode}>
      <FileProcessingTestPanel />
    </SettingContainer>
  )
}

export default DocProcessTestSettings
