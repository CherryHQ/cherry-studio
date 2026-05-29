import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'
import '@ant-design/v5-patch-for-react-19'

import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { createRoot } from 'react-dom/client'

import SelectionActionApp from './SelectionActionApp'

loggerService.initWindowSource('SelectionActionWindow')

await preferenceService.preload([
  'app.language',
  'ui.custom_css',
  'ui.theme_mode',
  'ui.theme_user.color_primary',
  'feature.selection.auto_close',
  'feature.selection.auto_pin',
  'feature.selection.action_window_opacity'
])

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<SelectionActionApp />)
