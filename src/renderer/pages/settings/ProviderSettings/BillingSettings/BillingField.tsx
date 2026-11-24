import type { ReactNode } from 'react'

import { PageSidePanelItem } from '@cherrystudio/ui'

export function BillingField({ label, children, error }: { label: string; children: ReactNode; error?: string }) {
  return (
    <PageSidePanelItem title={label}>
      {children}
      {error && (
        <p role="alert" className="text-xs text-error">
          {error}
        </p>
      )}
    </PageSidePanelItem>
  )
}
