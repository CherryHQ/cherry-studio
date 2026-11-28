import './style.css'

import { createRoot } from 'react-dom/client'

import i18next, { initializeLanguage } from './i18n'
import { MeetingApp } from './MeetingApp'

const root = document.getElementById('root')!
if (!window.cherry) {
  await initializeLanguage(navigator.language)
  root.textContent = i18next.t('hostRequired')
} else {
  const { locale } = await window.cherry.app.getInfo()
  await initializeLanguage(locale)
  document.documentElement.lang = locale
  document.title = i18next.t('title')
  window.cherry.on('app.localeChange', ({ locale: next }) => {
    void i18next.changeLanguage(next).then(() => {
      document.documentElement.lang = next
      document.title = i18next.t('title')
    })
  })
  createRoot(root).render(<MeetingApp />)
}
