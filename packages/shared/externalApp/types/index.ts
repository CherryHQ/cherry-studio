export type ExternalAppTag = 'code-editor'

export type ExternalAppId = 'vscode' | 'cursor' | 'zed'

export interface ExternalAppConfig {
  id: ExternalAppId
  name: string
  protocol: string
  tags: ExternalAppTag[]
}

export interface ExternalAppInfo extends ExternalAppConfig {
  path: string
}
