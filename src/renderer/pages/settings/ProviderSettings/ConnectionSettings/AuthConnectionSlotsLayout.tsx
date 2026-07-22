import { useProvider } from '@renderer/hooks/useProvider'
import { cn } from '@renderer/utils/style'
import { matchesPreset } from '@shared/utils/provider'
import type { ReactNode } from 'react'

import { authConnectionClasses } from '../primitives/ProviderSettingsPrimitives'
import ProviderSpecificSettings from '../ProviderSpecific/ProviderSpecificSettings'

interface AuthConnectionSlotsLayoutProps {
  providerId: string
  children: ReactNode
}

export default function AuthConnectionSlotsLayout({ providerId, children }: AuthConnectionSlotsLayoutProps) {
  const { provider } = useProvider(providerId)
  const isAwsBedrock = providerId === 'aws-bedrock' || (provider ? matchesPreset(provider, 'aws-bedrock') : false)

  return (
    <section className="shrink-0 space-y-4">
      <ProviderSpecificSettings providerId={providerId} placement="beforeAuth" />
      <div className="flex flex-col gap-3">
        <div className={authConnectionClasses.shell}>
          <div className={cn(authConnectionClasses.body, isAwsBedrock && 'gap-1')}>
            {children}
            <ProviderSpecificSettings providerId={providerId} placement="afterAuth" />
          </div>
        </div>
      </div>
    </section>
  )
}
