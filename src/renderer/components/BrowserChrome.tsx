import type { ComponentProps, ReactNode } from 'react'

import { WebviewNavigation } from './WebviewNavigation'

type Props = ComponentProps<typeof WebviewNavigation> & {
  banner?: ReactNode
  children: ReactNode
}

export function BrowserChrome({ banner, children, ...navigation }: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <WebviewNavigation {...navigation} />
      {banner}
      <div className="relative min-h-0 flex-1 bg-white">{children}</div>
    </div>
  )
}
