/**
 * Entry point for the migration v2 window
 * Initializes the migration UI with @cherrystudio/ui components
 */
import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'

import { createRoot } from 'react-dom/client'

import { initI18n } from './i18n'
import MigrationApp from './MigrationApp'

const root = createRoot(document.getElementById('root') as HTMLElement)

// Wait for i18n to be fully initialized before rendering
void initI18n().then(() => {
  root.render(<MigrationApp />)
})
