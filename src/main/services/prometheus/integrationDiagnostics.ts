import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'

import { application } from '@application'
import type {
  IntegrationConfig,
  IntegrationDiagnostic,
  WorkspaceIntegration
} from '@shared/types/prometheusIntegration'

import { readSecrets } from './integrationConfig'
import { surrealSql } from './surrealConnection'
import { registerWorkspaceServers, workspaceDatabase } from './workspaceMcp'

function text(value: unknown): string {
  const result = CallToolResultSchema.parse(value)
  if (result.isError) throw new Error('prometheus.error.toolOperation')
  return result.content
    .filter((entry) => entry.type === 'text')
    .map((entry) => entry.text)
    .join('\n')
}

/** Explicit Settings action; never runs as an automatic test or during startup. */
export async function runIntegrationDiagnostics(
  workspace: WorkspaceIntegration,
  config: IntegrationConfig,
  signal: AbortSignal
): Promise<IntegrationDiagnostic[]> {
  const results: IntegrationDiagnostic[] = []
  const runtime = application.get('McpRuntimeService')
  const servers = await registerWorkspaceServers(workspace, config)
  const secrets = await readSecrets()
  const check = async (id: string, run: () => Promise<void>) => {
    signal.throwIfAborted()
    try {
      await run()
      results.push({ id, state: 'operational' })
    } catch (error) {
      signal.throwIfAborted()
      const message = error instanceof Error ? error.message : String(error)
      results.push({
        id,
        state: 'failed',
        detail: Object.values(secrets)
          .filter(Boolean)
          .reduce((value, secret) => value.split(secret).join('[redacted]'), message)
      })
    }
  }
  for (const server of servers) {
    await check(`mcp:${server.reference}`, async () => {
      await runtime.withClient(server.id, async (client) => {
        const { tools } = await client.listTools({}, { signal })
        if (!tools.length) throw new Error('prometheus.error.noTools')
        if (server.reference?.startsWith('filesystem:')) {
          const directory = await fs.mkdtemp(path.join(workspace.path, '.the-boss-diagnostic-'))
          const filename = path.join(directory, 'probe.txt')
          const token = randomUUID()
          try {
            if (config.filesystem.allowWrite)
              text(
                await client.callTool(
                  { name: 'write_file', arguments: { path: filename, content: token } },
                  undefined,
                  { signal }
                )
              )
            else await fs.writeFile(filename, token)
            const response = text(
              await client.callTool({ name: 'read_text_file', arguments: { path: filename } }, undefined, { signal })
            )
            if (!response.includes(token)) throw new Error('prometheus.error.roundTrip')
          } finally {
            await fs.rm(directory, { recursive: true, force: true })
          }
        } else if (server.reference?.startsWith('compass:')) {
          text(
            await client.callTool({ name: 'query_graph', arguments: { query: 'find symbols named main' } }, undefined, {
              signal
            })
          )
        } else if (server.reference === 'surreal-memory') {
          const token = `The Boss diagnostic ${randomUUID()}`
          const created = JSON.parse(
            text(
              await client.callTool(
                {
                  name: 'add_memory',
                  arguments: { content: token, agent_id: 'the-boss-diagnostics', user_id: 'anonymous' }
                },
                undefined,
                { signal }
              )
            )
          ) as { id: string }
          if (!created.id) throw new Error('prometheus.error.roundTrip')
          try {
            const response = text(
              await client.callTool({ name: 'get_memory', arguments: { id: created.id } }, undefined, { signal })
            )
            if (!response.includes(token)) throw new Error('prometheus.error.roundTrip')
          } finally {
            text(await client.callTool({ name: 'delete_memory', arguments: { id: created.id } }))
          }
        }
      })
    })
  }
  if (
    config.compass.enabled &&
    (config.compass.storage === 'automatic' || config.compass.storage === 'remote') &&
    secrets.compassPassword
  )
    await check('surrealdb', async () => {
      const response = await fetch(new URL('/health', config.compass.endpoint), {
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)])
      })
      await response.body?.cancel()
      if (!response.ok) throw new Error('prometheus.error.serviceUnavailable')
      results.push({ id: 'surrealdb:transport', state: 'listening' })
      await surrealSql(
        config.compass.endpoint,
        'RETURN 1;',
        { ...config.compass, password: secrets.compassPassword!, database: workspaceDatabase(workspace.id) },
        signal
      )
      results.push({ id: 'surrealdb:credentials', state: 'authenticated' })
    })
  else results.push({ id: 'surrealdb', state: 'disabled' })
  const literRoles = config.services.literRoles
  const gatewayRoles = literRoles
    ? (['critic', 'judge', 'backup'] as const).map((role) => ({
        role,
        model: literRoles[role].servedAlias.alias
      }))
    : (['judge', 'critic'] as const).map((role) => ({ role, model: config.services[role].name }))
  for (const { role, model } of gatewayRoles) {
    if (!model) {
      results.push({ id: `liter:${role}`, state: 'disabled' })
      continue
    }
    await check(`liter:${role}`, async () => {
      const response = await fetch(`${config.services.liter.endpoint.replace(/\/$/, '')}/v1/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secrets.literKey ?? ''}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          max_tokens: 16
        })
      })
      if (!response.ok) throw new Error('prometheus.error.gatewayRequest')
      const body = (await response.json()) as { choices?: unknown[] }
      if (!body.choices?.length) throw new Error('prometheus.error.gatewayResponse')
    })
  }
  return results
}
