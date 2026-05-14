import { providerListClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import type { ReactNode } from 'react'

import ProviderListHeaderTitle from './ProviderListHeaderTitle'

export type { ProviderFilterMode } from './providerFilterMode'

interface ProviderListHeaderBarProps {
  /** Right-side slot — currently houses the icon-only "+ add provider" trigger. */
  action?: ReactNode
}

export default function ProviderListHeaderBar({ action }: ProviderListHeaderBarProps) {
  return (
    <div className={providerListClasses.header}>
      <ProviderListHeaderTitle />
      {action}
    </div>
  )
}
