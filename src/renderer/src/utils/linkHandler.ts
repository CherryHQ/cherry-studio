import MinApp from '@renderer/components/MinApp'
import { AppLogo } from '@renderer/config/env'
import { t } from 'i18next'
import React from 'react'

export const handleInAppLink = (event: React.MouseEvent<HTMLAnchorElement>, url: string) => {
  event.preventDefault()

  let appName: string
  try {
    const urlObj = new URL(url)
    appName = urlObj.hostname.replace('www.', '')
  } catch (e) {
    appName = t('external.link')
  }

  MinApp.start({
    id: `web-${Date.now()}`,
    name: appName,
    url: url,
    logo: AppLogo
  })
}
