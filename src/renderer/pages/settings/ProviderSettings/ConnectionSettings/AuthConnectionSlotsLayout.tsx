import type { ReactNode } from 'react'

import { authConnectionClasses } from '../primitives/ProviderSettingsPrimitives'
import ProviderSpecificSettings from '../ProviderSpecific/ProviderSpecificSettings'

interface AuthConnectionSlotsLayoutProps {
  providerId: string
  children: ReactNode
}

export default function AuthConnectionSlotsLayout({ providerId, children }: AuthConnectionSlotsLayoutProps) {
  return (
    <section className="shrink-0 space-y-4">
      <ProviderSpecificSettings providerId={providerId} placement="beforeAuth" />
      <div className="flex flex-col gap-3">
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
