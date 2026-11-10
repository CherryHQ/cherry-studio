import type { ReactNode } from 'react'

export function BillingField({ label, children, error }: { label: string; children: ReactNode; error?: string }) {
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium">{label}</div>
      {children}
      {error && (
        <p role="alert" className="text-xs text-error">
          {error}
        </p>
      )}
    </div>
  )
}
