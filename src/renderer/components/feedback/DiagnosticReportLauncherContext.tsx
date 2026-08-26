import { createContext, type PropsWithChildren, use } from 'react'

type OpenDiagnosticReport = (description?: string) => void

const DiagnosticReportLauncherContext = createContext<OpenDiagnosticReport | undefined>(undefined)

export function DiagnosticReportLauncherProvider({
  children,
  openReport
}: PropsWithChildren<{ readonly openReport?: OpenDiagnosticReport }>) {
  return <DiagnosticReportLauncherContext value={openReport}>{children}</DiagnosticReportLauncherContext>
}

export function useOptionalDiagnosticReportLauncher() {
  return use(DiagnosticReportLauncherContext)
}
