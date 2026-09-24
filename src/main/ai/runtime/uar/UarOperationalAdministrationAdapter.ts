import * as z from 'zod'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import type {
  UarAdministrationOwner,
  UarKnowledgeBaseInspection,
  UarOperationalSnapshot,
  UarRunInspection
} from '@shared/types/prometheusIntegration'

import { uarPrincipalForSession } from './uarPrincipal'

export const rawRun = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  conversation_id: z.string().nullable().optional(),
  status: z.enum(['pending', 'running', 'paused', 'done', 'error', 'cancelled']),
  agent_revision: z.string().nullable().optional(),
  effective_model: z.unknown().optional(),
  presentation_selection: z.unknown().optional()
})
const rawKnowledgeBase = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  config: z
    .object({
      embedding_provider: z.string(),
      embedding_model: z.string()
    })
    .passthrough(),
  document_count: z.number(),
  updated_at: z.string()
})
const rawDocument = z.object({
  id: z.string(),
  filename: z.string(),
  status: z.string(),
  chunk_count: z.number(),
  error_message: z.string().nullable().optional()
})
const rawMemory = z.object({
  id: z.string(),
  content: z.string(),
  scope: z.string(),
  user_id: z.string().nullable().optional(),
  agent_id: z.string().nullable().optional(),
  session_id: z.string().nullable().optional(),
  importance: z.number().optional(),
  created_at: z.string().optional()
})
const rawToolCatalog = z.object({
  tools: z.array(z.object({ namespaced_name: z.string() })).default([]),
  built_in_tools: z.array(z.object({ name: z.string() })).default([])
})
const rawMcpHealth = z.object({
  total_tools: z.number(),
  servers: z.array(z.object({ name: z.string(), status: z.string(), tool_count: z.number() }))
})
const rawCredential = z.object({ provider_id: z.string() })
const rawFederatedAgent = z.object({
  id: z.string(),
  name: z.string(),
  base_url: z.string(),
  capabilities: z.array(z.string()).default([])
})
export const rawCheckpointResponse = z.object({
  checkpoints: z.array(
    z.object({
      id: z.string(),
      node_id: z.string(),
      iteration: z.number(),
      created_at: z.string(),
      protection: z
        .object({ completeness: z.enum(['complete', 'incomplete_legacy']) })
        .nullable()
        .optional()
    })
  )
})

export async function body(response: Response, label: string): Promise<unknown> {
  const text = await response.text()
  let parsed: unknown = text
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      // Preserve the server's plain-text diagnostic.
    }
  }
  if (!response.ok) {
    const message =
      typeof parsed === 'object' && parsed !== null && 'error' in parsed
        ? typeof parsed.error === 'string'
          ? parsed.error
          : JSON.stringify(parsed.error)
        : typeof parsed === 'string' && parsed
          ? parsed
          : `${label} failed with HTTP ${response.status}`
    throw new Error(message)
  }
  return parsed
}

export function owners(): UarAdministrationOwner[] {
  const result: UarAdministrationOwner[] = []
  let cursor: string | undefined
  do {
    const page = agentSessionService.listByCursor({ cursor, limit: 200 })
    for (const session of page.items) {
      if (!session.agentId) continue
      const agent = agentService.getAgent(session.agentId)
      if (!agent || agent.type !== 'uar') continue
      result.push({
        sessionId: session.id,
        sessionName: session.name || session.id,
        agentId: agent.id,
        agentName: agent.name
      })
    }
    cursor = page.nextCursor
  } while (cursor && result.length < 2_000)
  return result
}

function owner(sessionId: string): UarAdministrationOwner {
  const session = agentSessionService.getById(sessionId)
  if (!session.agentId) throw new Error('The selected UAR conversation no longer has an agent')
  const agent = agentService.getAgent(session.agentId)
  if (!agent || agent.type !== 'uar') throw new Error('The selected conversation is not backed by UAR')
  return {
    sessionId: session.id,
    sessionName: session.name || session.id,
    agentId: agent.id,
    agentName: agent.name
  }
}

export async function ownerRequest(
  sessionId: string,
  path: string,
  init: RequestInit = {},
  expectedGeneration?: number
): Promise<Response> {
  owner(sessionId)
  return application.get('UarSidecarService').request(path, uarPrincipalForSession(sessionId), init, expectedGeneration)
}

export function projectRun(run: z.infer<typeof rawRun>, ownerSessionId: string): UarRunInspection {
  return {
    runId: run.run_id,
    ownerSessionId,
    agentId: run.agent_id,
    ...(run.conversation_id ? { conversationId: run.conversation_id } : {}),
    status: run.status,
    ...(run.agent_revision ? { agentRevision: run.agent_revision } : {}),
    ...(run.effective_model !== undefined ? { effectiveModel: run.effective_model } : {}),
    ...(run.presentation_selection !== undefined ? { presentationSelection: run.presentation_selection } : {})
  }
}

async function optional<T>(
  surface: string,
  failures: UarOperationalSnapshot['failures'],
  operation: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    failures.push({ surface, message: error instanceof Error ? error.message : String(error) })
    return fallback
  }
}

export async function readUarOperations(): Promise<UarOperationalSnapshot> {
  const sidecar = application.get('UarSidecarService')
  const endpoint = await sidecar.ensureReady()
  const availableOwners = owners()
  const failures: UarOperationalSnapshot['failures'] = []

  const perOwner = await Promise.all(
    availableOwners.map(async (current) => {
      const [runs, knowledge, credentials] = await Promise.all([
        optional(
          'runs',
          failures,
          async () =>
            z
              .array(rawRun)
              .parse(
                await body(
                  await ownerRequest(current.sessionId, '/api/uar/runs', {}, endpoint.generation),
                  'Run inventory'
                )
              ),
          []
        ),
        optional(
          'knowledge',
          failures,
          async () =>
            z
              .array(rawKnowledgeBase)
              .parse(
                await body(
                  await ownerRequest(current.sessionId, '/api/uar/knowledge-bases', {}, endpoint.generation),
                  'Knowledge inventory'
                )
              ),
          []
        ),
        optional(
          'security',
          failures,
          async () =>
            z
              .array(rawCredential)
              .parse(
                await body(
                  await ownerRequest(current.sessionId, '/api/uar/credentials', {}, endpoint.generation),
                  'Credential inventory'
                )
              ),
          []
        )
      ])
      const documents = new Map<string, z.infer<typeof rawDocument>[]>()
      await Promise.all(
        knowledge.map(async (kb) => {
          const items = await optional(
            'knowledge',
            failures,
            async () =>
              z
                .array(rawDocument)
                .parse(
                  await body(
                    await ownerRequest(
                      current.sessionId,
                      `/api/uar/knowledge-bases/${encodeURIComponent(kb.id)}/documents`,
                      {},
                      endpoint.generation
                    ),
                    'Knowledge documents'
                  )
                ),
            []
          )
          documents.set(kb.id, items)
        })
      )
      return { owner: current, runs, knowledge, credentials, documents }
    })
  )

  const [memory, toolCatalog, mcpHealth, governance, federatedAgents, federatedSkills, a2aCard, acp] =
    await Promise.all([
      optional(
        'knowledge',
        failures,
        async () =>
          z
            .object({ enabled: z.boolean().default(true), total: z.number(), items: z.array(rawMemory) })
            .parse(
              await body(await sidecar.adminRequest('/api/admin/memories', {}, endpoint.generation), 'Memory inventory')
            ),
        { enabled: false, total: 0, items: [] }
      ),
      optional(
        'tools',
        failures,
        async () =>
          rawToolCatalog.parse(
            await body(await sidecar.adminRequest('/api/tools', {}, endpoint.generation), 'Tool catalog')
          ),
        { tools: [], built_in_tools: [] }
      ),
      optional(
        'tools',
        failures,
        async () =>
          rawMcpHealth.parse(
            await body(await sidecar.adminRequest('/api/uar/mcp/health', {}, endpoint.generation), 'MCP health')
          ),
        { total_tools: 0, servers: [] }
      ),
      optional(
        'security',
        failures,
        async () =>
          z
            .object({ effective_enabled: z.boolean() })
            .passthrough()
            .parse(
              await body(
                await sidecar.adminRequest('/api/uar/settings/governance/status', {}, endpoint.generation),
                'Governance status'
              )
            ),
        undefined
      ),
      optional(
        'protocols',
        failures,
        async () =>
          z
            .array(rawFederatedAgent)
            .parse(
              await body(await sidecar.adminRequest('/a2a/registry/agents', {}, endpoint.generation), 'A2A registry')
            ),
        []
      ),
      optional(
        'protocols',
        failures,
        async () =>
          z
            .array(z.unknown())
            .parse(
              await body(await sidecar.adminRequest('/a2a/registry/skills', {}, endpoint.generation), 'A2A skills')
            ),
        []
      ),
      optional(
        'protocols',
        failures,
        async () => body(await sidecar.adminRequest('/.well-known/agent.json', {}, endpoint.generation), 'A2A card'),
        undefined
      ),
      optional(
        'protocols',
        [],
        async () =>
          body(await sidecar.adminRequest('/api/uar/settings/acp', {}, endpoint.generation), 'ACP configuration'),
        undefined
      )
    ])

  return {
    schemaVersion: 1,
    generation: endpoint.generation,
    owners: availableOwners,
    runs: perOwner.flatMap((item) => item.runs.map((run) => projectRun(run, item.owner.sessionId))),
    knowledgeBases: perOwner.flatMap((item) =>
      item.knowledge.map(
        (kb): UarKnowledgeBaseInspection => ({
          ownerSessionId: item.owner.sessionId,
          id: kb.id,
          name: kb.name,
          ...(kb.description ? { description: kb.description } : {}),
          documentCount: kb.document_count,
          embeddingProvider: kb.config.embedding_provider,
          embeddingModel: kb.config.embedding_model,
          updatedAt: kb.updated_at,
          documents: (item.documents.get(kb.id) ?? []).map((document) => ({
            id: document.id,
            filename: document.filename,
            status: document.status,
            chunkCount: document.chunk_count,
            ...(document.error_message ? { error: document.error_message } : {})
          }))
        })
      )
    ),
    memory: {
      enabled: memory.enabled,
      total: memory.total,
      items: memory.items.map((item) => ({
        id: item.id,
        content: item.content,
        scope: item.scope,
        ...(item.user_id ? { userId: item.user_id } : {}),
        ...(item.agent_id ? { agentId: item.agent_id } : {}),
        ...(item.session_id ? { sessionId: item.session_id } : {}),
        ...(item.importance !== undefined ? { importance: item.importance } : {}),
        ...(item.created_at ? { createdAt: item.created_at } : {})
      }))
    },
    tools: {
      total: toolCatalog.tools.length + toolCatalog.built_in_tools.length,
      names: [
        ...toolCatalog.built_in_tools.map((tool) => tool.name),
        ...toolCatalog.tools.map((tool) => tool.namespaced_name)
      ].sort(),
      mcpServers: mcpHealth.servers.map((server) => ({
        name: server.name,
        status: server.status,
        toolCount: server.tool_count
      })),
      hostControlled: true
    },
    security: {
      governance: governance ? (governance.effective_enabled ? 'enabled' : 'disabled') : 'unavailable',
      credentialProvidersBySession: Object.fromEntries(
        perOwner.map((item) => [item.owner.sessionId, item.credentials.map((entry) => entry.provider_id)])
      )
    },
    protocols: {
      a2a: a2aCard === undefined ? 'unavailable' : 'available',
      acp: acp === undefined ? 'unavailable' : 'available',
      federatedAgents: federatedAgents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        baseUrl: agent.base_url,
        capabilities: agent.capabilities
      })),
      federatedSkills: federatedSkills.length
    },
    failures
  }
}
