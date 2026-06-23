import '@ant-design/v5-patch-for-react-19'

import { preferenceService } from '@data/PreferenceService'
import { createRoot } from 'react-dom/client'

import SelectionToolbarApp from './SelectionToolbarApp'

await preferenceService.preload([
  'app.language',
  'ui.custom_css',
  'ui.theme_mode',
  'ui.theme_user.color_primary',
  'feature.selection.compact',
  'feature.selection.action_items'
])

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<SelectionToolbarApp />)
