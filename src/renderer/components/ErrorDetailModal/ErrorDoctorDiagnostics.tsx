import { useEffect } from 'react'

import { useDoctorController } from '@renderer/hooks/doctor'
import type { DoctorNavigateTarget, DoctorSubjectRef } from '@shared/types/doctor'

import { ErrorDiagnosisPanel } from './ErrorDiagnosisPanel'

interface ErrorDoctorDiagnosticsProps {
  subject: DoctorSubjectRef
  onNavigate: (target: DoctorNavigateTarget) => void
  onReportProblem?: (description: string) => void
  onRunFullCheck?: () => void
  onCloseBlockedChange?: (blocked: boolean) => void
}

export function ErrorDoctorDiagnostics({
  subject,
  onNavigate,
  onReportProblem,
  onRunFullCheck,
  onCloseBlockedChange
}: ErrorDoctorDiagnosticsProps) {
  const controller = useDoctorController({ initialPanel: 'checks', subject, onNavigate, onReportProblem })
  useEffect(() => {
    onCloseBlockedChange?.(controller.isCloseBlocked)
    return () => onCloseBlockedChange?.(false)
  }, [controller.isCloseBlocked, onCloseBlockedChange])
  return (
    <ErrorDiagnosisPanel
      doctorController={controller}
      onRunFullCheck={onRunFullCheck ?? (() => void controller.run('live'))}
      subject={subject}
    />
  )
}
