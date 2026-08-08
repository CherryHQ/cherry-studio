export type ExternalAppTag = 'code-editor' | 'terminal'

export type ExternalAppId = 'vscode' | 'cursor' | 'zed' | 'wt'

export interface ExternalAppConfig {
  id: ExternalAppId
  name: string
  /**
   * Deep-link protocol (e.g. `vscode://`) used to open the app via a URL.
   * Absent for executable-based apps (e.g. Windows Terminal).
   */
  protocol?: string
  tags: ExternalAppTag[]
  /**
   * When set, the app is launched by spawning this executable instead of
   * opening a protocol URL (e.g. `wt.exe` — Windows Terminal registers no
   * URL scheme, it is invoked as `wt.exe -d <directory>`).
   */
  executable?: string
}

export interface ExternalAppInfo extends ExternalAppConfig {
  path: string
}
