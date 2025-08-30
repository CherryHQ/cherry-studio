export type ApiClient = {
  model: string
  provider: string
  apiKey: string
  apiVersion?: string
  baseURL: string
}
export interface ApiServerConfig {
  enabled: boolean
  host: string
  port: number
  apiKey: string
}
