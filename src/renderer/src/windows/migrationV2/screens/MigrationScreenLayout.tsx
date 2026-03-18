import type { ReactNode } from 'react'

import { MigrationFooter } from '../components'

type Props = {
  currentStep: number
  footerMessage: string
  secondaryAction?: ReactNode
  primaryAction?: ReactNode
  children: ReactNode
}

export function MigrationScreenLayout({ currentStep, footerMessage, secondaryAction, primaryAction, children }: Props) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <main className="flex flex-1 overflow-auto">
        <div className="mx-auto flex min-h-full w-full max-w-190 flex-col justify-center px-6 py-12">{children}</div>
      </main>

      <MigrationFooter
        currentStep={currentStep}
        totalSteps={4}
        message={footerMessage}
        secondaryAction={secondaryAction}
        primaryAction={primaryAction}
      />
    </div>
  )
}
