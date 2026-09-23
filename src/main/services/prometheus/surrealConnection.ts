import type { IntegrationConfig } from '@shared/types/prometheusIntegration'
import { readSecrets } from './integrationConfig'

export async function surrealSql(endpoint: string, sql: string, credentials: {
  username: string; password: string; namespace?: string; database?: string; authLevel?: string
}, signal?: AbortSignal, variables: Record<string, unknown> = {}): Promise<unknown[]> {
  const timeout = AbortSignal.timeout(15000)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  const signin = await fetch(new URL('/signin', endpoint), {
    method: 'POST', signal: requestSignal,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: credentials.username, pass: credentials.password,
      ...(credentials.authLevel !== 'root' && credentials.namespace ? { ns: credentials.namespace } : {}),
      ...(credentials.authLevel === 'database' ? { db: credentials.database } : {}) })
  })
  const auth = await signin.json() as { token?: string }
  if (!signin.ok || !auth.token) throw new Error('prometheus.error.authentication')
  const response = await fetch(new URL('/rpc', endpoint), {
    method: 'POST', signal: requestSignal,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}`,
      ...(credentials.namespace ? { 'Surreal-NS': credentials.namespace } : {}),
      ...(credentials.database ? { 'Surreal-DB': credentials.database } : {}) },
    body: JSON.stringify({ id: 'boss', method: 'query', params: [sql, variables] })
  })
  const body = await response.json() as { result?: { status: string; result: unknown }[] }
  const results = body.result
  if (!response.ok || !Array.isArray(results) || results.some((result) => result.status !== 'OK')) {
    // Never expose raw database responses: setup statements contain passwords.
    throw new Error('prometheus.error.databaseOperation')
  }
  return results.map((result) => result.result)
}

export async function compassRemoteReady(config: IntegrationConfig, database: string): Promise<boolean> {
  const secrets = await readSecrets()
  if (!secrets.compassPassword) return false
  try {
    const [value] = await surrealSql(config.compass.endpoint, 'RETURN 1;', {
      ...config.compass, database, password: secrets.compassPassword
    })
    return value === 1
  } catch { return false }
}

export async function compassEnvironment(config: IntegrationConfig, database: string): Promise<Record<string, string>> {
  const secrets = await readSecrets()
  return {
    COMPASS_SURREAL_ENGINE: 'remote', COMPASS_SURREAL_ENDPOINT: config.compass.endpoint,
    COMPASS_SURREAL_NAMESPACE: config.compass.namespace, COMPASS_SURREAL_DATABASE: database,
    COMPASS_SURREAL_AUTH_LEVEL: config.compass.authLevel,
    COMPASS_SURREAL_USERNAME: config.compass.username, COMPASS_SURREAL_PASSWORD: secrets.compassPassword ?? ''
  }
}
