import { useMainWindowNavigation } from '@renderer/hooks/tab'
import type { SettingsPath } from '@shared/data/types/settingsPath'
import { createContext, type ReactNode, use } from 'react'

type SettingsSurfaceValue = {
  settingsPath: SettingsPath | null
  setSettingsPath: (path: string) => void
  closeSettings: () => void
}

const SettingsSurfaceContext = createContext<SettingsSurfaceValue | null>(null)

/**
 * Mounts the main window's single navigation consumption point and publishes the immersive
 * Settings state it produces. It wraps the window content — onboarding included — because route
 * delivery and protocol readiness must not wait for AppShell, while AppShell is the only consumer
 * of the Settings surface itself.
 */
export function SettingsSurfaceProvider({ children }: { children: ReactNode }) {
  const settingsSurface = useMainWindowNavigation()

  return <SettingsSurfaceContext value={settingsSurface}>{children}</SettingsSurfaceContext>
}

export function useSettingsSurface(): SettingsSurfaceValue {
  const settingsSurface = use(SettingsSurfaceContext)
  if (!settingsSurface) {
    throw new Error('useSettingsSurface must be used within a SettingsSurfaceProvider')
  }
  return settingsSurface
}
