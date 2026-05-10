import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderSpecificSettings from '../ProviderSpecific/ProviderSpecificSettings'
import { authConnectionClasses } from '../shared/primitives/ProviderSettingsPrimitives'

interface AuthConnectionSlotsLayoutProps {
  providerId: string
  children: ReactNode
}

export default function AuthConnectionSlotsLayout({ providerId, children }: AuthConnectionSlotsLayoutProps) {
  const { t } = useTranslation()
  const headingId = 'provider-auth-connection-heading'

  return (
    <section className="shrink-0 space-y-2.5">
      <ProviderSpecificSettings providerId={providerId} placement="beforeAuth" />
      <div className={authConnectionClasses.shell} aria-labelledby={headingId}>
        <h2 id={headingId} className={authConnectionClasses.blockTitle}>
          {t('settings.provider.auth_connection_section')}
        </h2>
        <div className={authConnectionClasses.body}>
          {children}
          <ProviderSpecificSettings providerId={providerId} placement="afterAuth" />
        </div>
      </div>
    </section>
  )
}
