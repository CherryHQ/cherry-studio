/**
 * Entry point for the userData relocation window.
 *
 * This window is created by the preboot relocation gate
 * (`core/preboot/relocation/relocationGate.ts`) BEFORE
 * `application.bootstrap()`, so it cannot rely on any lifecycle service,
 * preference, or the main app's i18n. It detects the system language
 * independently and renders a self-contained progress UI.
 */
import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'

import { createRoot } from 'react-dom/client'

import { initI18n } from './i18n'
import RelocationApp from './RelocationApp'

const root = createRoot(document.getElementById('root') as HTMLElement)

void initI18n().then(() => {
  root.render(<RelocationApp />)
})
