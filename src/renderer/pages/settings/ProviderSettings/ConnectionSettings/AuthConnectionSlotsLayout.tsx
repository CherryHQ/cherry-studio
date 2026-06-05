import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { authConnectionClasses, sectionHeadingClasses } from '../primitives/ProviderSettingsPrimitives'
import ProviderSpecificSettings from '../ProviderSpecific/ProviderSpecificSettings'

interface AuthConnectionSlotsLayoutProps {
  providerId: string
  children: ReactNode
}

export default function AuthConnectionSlotsLayout({ providerId, children }: AuthConnectionSlotsLayoutProps) {
  const { t } = useTranslation()
  const headingId = 'provider-auth-connection-heading'

  return (
    <section className="shrink-0 space-y-8">
      <ProviderSpecificSettings providerId={providerId} placement="beforeAuth" />
      <div className="flex flex-col gap-3" aria-labelledby={headingId}>
        <h3 id={headingId} className={sectionHeadingClasses}>
          {t('settings.provider.section.configuration')}
        </h3>
        <div className={authConnectionClasses.shell}>
          <div className={authConnectionClasses.body}>
            {children}
            <ProviderSpecificSettings providerId={providerId} placement="afterAuth" />
          </div>
        </div>
      </div>
    </section>
  )
}
