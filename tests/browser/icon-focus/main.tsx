import i18next from 'i18next'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'

import SelectionActionIconGrid from '../../../src/renderer/pages/settings/SelectionAssistantSettings/components/SelectionActionIconGrid'

import '../../../src/renderer/assets/styles/index.css'
import '../../../src/renderer/assets/styles/tailwind.css'

await i18next.init({
  lng: 'en-US',
  resources: { 'en-US': { translation: { common: { search: 'Search', no_results: 'No results' } } } }
})
function Fixture() {
  const [value, setValue] = useState('')
  return (
    <I18nextProvider i18n={i18next}>
      <main style={{ width: 320, padding: 16 }}>
        <SelectionActionIconGrid value={value} onSelect={setValue} />
        <output aria-label="Selected icon">{value}</output>
      </main>
    </I18nextProvider>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
