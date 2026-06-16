import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { authConnectionClasses, modelListClasses } from '../primitives/ProviderSettingsPrimitives'
import ProviderSpecificSettings from '../ProviderSpecific/ProviderSpecificSettings'

interface AuthConnectionSlotsLayoutProps {
  providerId: string
  children: ReactNode
}

export default function AuthConnectionSlotsLayout({ providerId, children }: AuthConnectionSlotsLayoutProps) {
  const { t } = useTranslation()
  return (
    <section className="shrink-0">
      <h2 className={modelListClasses.sectionTitle}>{t('settings.provider.connection_title')}</h2>
      <div className="mt-2 space-y-3">
        <ProviderSpecificSettings providerId={providerId} placement="beforeAuth" />
        <div className="flex flex-col gap-3">
          <div className={authConnectionClasses.shell}>
            <div className={authConnectionClasses.body}>
              {children}
              <ProviderSpecificSettings providerId={providerId} placement="afterAuth" />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
