import '@ant-design/v5-patch-for-react-19'

import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { ThemeProvider } from '@renderer/context/ThemeProvider'
import type { FC } from 'react'
import { createRoot } from 'react-dom/client'

import SelectionToolbar from './SelectionToolbar'

loggerService.initWindowSource('SelectionToolbar')
await preferenceService.preload([
  'app.language',
  'ui.custom_css',
  'ui.theme_mode',
  'ui.theme_user.color_primary',
  'feature.selection.compact',
  'feature.selection.action_items'
])

const App: FC = () => {
  return (
    <ThemeProvider>
      <SelectionToolbar />
    </ThemeProvider>
  )
}

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<App />)
