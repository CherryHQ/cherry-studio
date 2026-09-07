import { WebviewBrowser } from '@renderer/components/WebviewBrowser'
import { useCurrentTab, useIsActiveTab } from '@renderer/hooks/tab'
import { WebviewSecurityProfile } from '@shared/utils/webviewSecurity'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

export function BrowserPage({ initialUrl }: { initialUrl: string }) {
  const { t } = useTranslation()
  const tab = useCurrentTab()
  const isActive = useIsActiveTab()
  const id = useId()

  return (
    <WebviewBrowser
      initialUrl={initialUrl}
      securityProfile={WebviewSecurityProfile.AgentBrowser}
      target={{ id: `browser:${tab?.id ?? id}`, label: t('settings.browser.title') }}
      isHostActive={isActive}
    />
  )
}
