import { useNavigate } from '@tanstack/react-router'
import { useCallback, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { WebviewBrowser } from '@renderer/components/WebviewBrowser'
import { useCurrentTab, useIsActiveTab, useTabSelfVisuals } from '@renderer/hooks/tab'
import { WebviewSecurityProfile } from '@shared/utils/webviewSecurity'

export function BrowserPage({ initialUrl }: { initialUrl: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate({ from: '/app/browser' })
  const tab = useCurrentTab()
  const isActive = useIsActiveTab()
  const id = useId()
  const [title, setTitle] = useState(initialUrl)
  const [favicon, setFavicon] = useState<string>()
  useTabSelfVisuals({ title: title || t('settings.browser.title'), icon: favicon, appId: 'browser' })

  const handleUrlChange = useCallback(
    (url: string) => {
      if (url !== initialUrl) void navigate({ search: { url }, replace: true })
    },
    [initialUrl, navigate]
  )

  return (
    <WebviewBrowser
      initialUrl={initialUrl}
      securityProfile={
        initialUrl.startsWith('file:') ? WebviewSecurityProfile.AgentHtmlArtifact : WebviewSecurityProfile.AgentBrowser
      }
      target={{ id: `browser:${tab?.id ?? id}`, label: t('settings.browser.title') }}
      isHostActive={isActive}
      onNavigate={handleUrlChange}
      onUrlChange={handleUrlChange}
      onTitleChange={setTitle}
      onFaviconChange={setFavicon}
    />
  )
}
