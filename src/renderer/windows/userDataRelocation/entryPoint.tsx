import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'

import { createRoot } from 'react-dom/client'

import { initI18n } from './i18n'
import RelocationApp from './RelocationApp'

const root = createRoot(document.getElementById('root') as HTMLElement)

void initI18n().then(() => {
  root.render(<RelocationApp />)
})
