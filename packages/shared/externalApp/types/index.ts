export type ExternalAppTag = 'code-editor'

export interface ExternalAppConfig {
  id: string
  name: string
  protocol: string
  tags: ExternalAppTag[]
}

export interface ExternalAppInfo extends ExternalAppConfig {
  path: string
}
