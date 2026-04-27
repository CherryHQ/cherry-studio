import type { ReactNode } from 'react'

import ProviderBlockHeading from './ProviderBlockHeading'
import ProviderSpecificSettings from './ProviderSpecificSettings'

interface AuthConnectionSlotsLayoutProps {
  providerId: string
  children: ReactNode
}

export default function AuthConnectionSlotsLayout({ providerId, children }: AuthConnectionSlotsLayoutProps) {
  return (
    <section className="shrink-0 space-y-2.5" aria-label="provider-connection-sections">
      <ProviderBlockHeading className="mb-4">连接认证 (Authentication)</ProviderBlockHeading>
      <ProviderSpecificSettings providerId={providerId} placement="beforeAuth" />
      {children}
      <ProviderSpecificSettings providerId={providerId} placement="afterAuth" />
    </section>
  )
}
