import { VStack } from '@cherrystudio/ui'
import type { ReactNode } from 'react'

import ProviderSpecificSettings from '../ProviderSpecific/ProviderSpecificSettings'

interface AuthConnectionSlotsLayoutProps {
  providerId: string
  children: ReactNode
}

export default function AuthConnectionSlotsLayout({ providerId, children }: AuthConnectionSlotsLayoutProps) {
  return (
    <section className="shrink-0 space-y-8">
      <ProviderSpecificSettings providerId={providerId} placement="beforeAuth" />
      <VStack gap={2}>
        {children}
        <ProviderSpecificSettings providerId={providerId} placement="afterAuth" />
      </VStack>
    </section>
  )
}
