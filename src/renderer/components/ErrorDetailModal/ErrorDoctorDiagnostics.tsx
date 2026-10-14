import { useEffect } from 'react'

import { useDoctorController } from '@renderer/hooks/doctor'
import type { DoctorNavigateTarget, DoctorSubjectRef } from '@shared/types/doctor'
import type { DoctorAgentIncident } from '@shared/types/doctorAgent'

import { ErrorDiagnosisPanel } from './ErrorDiagnosisPanel'

interface ErrorDoctorDiagnosticsProps {
  subject: DoctorSubjectRef
  incident?: DoctorAgentIncident
  onNavigate: (target: DoctorNavigateTarget) => void
  onReportProblem?: (description: string) => void
  onCloseBlockedChange?: (blocked: boolean) => void
}

export function ErrorDoctorDiagnostics({
  subject,
  incident,
  onNavigate,
  onReportProblem,
  onCloseBlockedChange
}: ErrorDoctorDiagnosticsProps) {
  const controller = useDoctorController({ initialPanel: 'checks', subject, onNavigate, onReportProblem })
  useEffect(() => {
    onCloseBlockedChange?.(controller.isCloseBlocked)
    return () => onCloseBlockedChange?.(false)
  }, [controller.isCloseBlocked, onCloseBlockedChange])
  return <ErrorDiagnosisPanel doctorController={controller} subject={subject} incident={incident} />
}
