import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { lazy, Suspense } from 'react'

import type { DoctorDialogParams } from './DoctorDialog'

const DoctorDialog = lazy(() => import('./DoctorDialog').then((module) => ({ default: module.DoctorDialog })))

type DoctorPopupProps = DoctorDialogParams & PopupInjectedProps<Record<string, never>>

function DoctorPopupContainer(props: DoctorPopupProps) {
  return (
    <Suspense fallback={null}>
      <DoctorDialog {...props} />
    </Suspense>
  )
}

const handle = createPopup<DoctorDialogParams, Record<string, never>>(DoctorPopupContainer, { dismissResult: {} })
const DoctorPopup = { show: handle.show } as const

export default DoctorPopup
