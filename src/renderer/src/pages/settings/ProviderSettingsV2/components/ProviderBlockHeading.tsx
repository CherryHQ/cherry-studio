import { cn } from '@renderer/utils'
import type { ReactNode } from 'react'

import { modelListClasses } from './ProviderSettingsPrimitives'

/** Block title aligned with `ModelListHeader` (`modelListClasses.sectionTitle` — semibold 14px tier). */
export default function ProviderBlockHeading({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn('mb-2.5', modelListClasses.sectionTitle, className)}>{children}</h2>
}
