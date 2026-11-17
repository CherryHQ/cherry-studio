import { lazy, Suspense } from 'react'

import type { DoctorAgentDialogProps } from './DoctorAgentConsultation'

// The consultation pulls the model selector and markdown stack; keep them out of every
// surface that merely imports the doctor barrel until the dialog is actually opened.
const DoctorAgentConsultation = lazy(() =>
  import('./DoctorAgentConsultation').then((module) => ({ default: module.DoctorAgentConsultation }))
)

export function DoctorAgentDialog(props: DoctorAgentDialogProps) {
  return (
    <Suspense fallback={null}>
      <DoctorAgentConsultation {...props} />
    </Suspense>
  )
}
