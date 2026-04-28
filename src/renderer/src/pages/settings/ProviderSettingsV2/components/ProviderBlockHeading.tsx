import { cn } from '@renderer/utils'
import type { ReactNode } from 'react'

import { modelListClasses } from './ProviderSettingsPrimitives'

/**
 * Section title aligned with `ModelListHeader` (`modelListClasses.sectionTitle` — semibold 14px tier).
 * The auth card heading uses `authConnectionClasses.blockTitle` instead (design: smaller tier inside bordered card).
 */
export default function ProviderBlockHeading({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn('mb-2.5', modelListClasses.sectionTitle, className)}>{children}</h2>
}
