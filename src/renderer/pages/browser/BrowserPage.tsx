import { WebviewBrowser } from '@renderer/components/WebviewBrowser'
import { useCurrentTab, useIsActiveTab, useTabSelfVisuals } from '@renderer/hooks/tab'
import { WebviewSecurityProfile } from '@shared/utils/webviewSecurity'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function BrowserPage({ initialUrl }: { initialUrl: string }) {
  const { t } = useTranslation()
  const tab = useCurrentTab()
  const isActive = useIsActiveTab()
  const id = useId()
  const [title, setTitle] = useState(initialUrl)
  const [favicon, setFavicon] = useState<string>()
  useTabSelfVisuals({ title: title || t('settings.browser.title'), icon: favicon, appId: 'browser' })

  return (
    <WebviewBrowser
      initialUrl={initialUrl}
      securityProfile={WebviewSecurityProfile.AgentBrowser}
      target={{ id: `browser:${tab?.id ?? id}`, label: t('settings.browser.title') }}
      isHostActive={isActive}
      onTitleChange={setTitle}
      onFaviconChange={setFavicon}
    />
  )
}
