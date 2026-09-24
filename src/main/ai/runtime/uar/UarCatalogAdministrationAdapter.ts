import * as z from 'zod'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { createAgent } from '@main/ai/agents/createAgent'
import { UniqueModelIdSchema } from '@shared/data/types/model'
import type {
  UarAgentCatalogItem,
  UarAgentRunTarget,
  UarAgentRunTargetInput,
  UarAgentSave,
  UarCatalogSnapshot,
  UarCompilerRequest,
  UarCompilerResult,
  UarFederatedAgentSave
} from '@shared/types/prometheusIntegration'
import { uarPresentationSelectionSchema } from '@shared/types/prometheusIntegration'

const rawArtifactSchema = z
  .object({
    version: z.string(),
    kind: z.string(),
    id: z.string(),
    metadata: z.object({ title: z.string(), description: z.string() }).passthrough(),
    policy: z
      .object({
        provider: z.object({
          default: z.object({ provider: z.string(), model: z.string() }),
          fallbacks: z.array(z.object({ provider: z.string(), model: z.string() })).default([])
        }),
        skills: z.object({ prefer: z.array(z.string()).default([]) }).passthrough()
      })
      .passthrough(),
    extensions: z.record(z.string(), z.unknown()).default({})
  })
  .passthrough()

const rawFederatedSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  base_url: z.string(),
  capabilities: z.array(z.string()),
  updated_at: z.string()
})

const rawSkillSchema = z.object({
  skill_id: z.string(),
  title: z.string(),
  description: z.string(),
  version: z.string(),
  enabled: z.boolean(),
  origin: z.union([z.string(), z.record(z.string(), z.unknown())]),
  provider_id: z.string()
})

const rawProvenanceSchema = z.object({
  pack: z.object({ version: z.string().nullable(), commit: z.string().nullable(), skill_count: z.number().nullable() }),
  loaded_skill_count: z.number(),
  drift: z.string().nullable()
})

const rawReportSchema = z.object({
  id: z.string(),
  agent_id: z.string(),
  version: z.string(),
  overall: z.enum(['pass', 'fail', 'skip']),
  total_duration_ms: z.number(),
  stages: z.array(
    z.object({
      stage: z.number(),
      name: z.string(),
      outcome: z.enum(['pass', 'fail', 'skip']),
      duration_ms: z.number(),
      diagnostics: z.array(
        z.object({ level: z.enum(['error', 'warning', 'info']), message: z.string(), section: z.string().optional() })
      )
    })
  )
})

const rawCompileSchema = z.object({
  descriptor: z.record(z.string(), z.unknown()),
  signature: z.string(),
  report: rawReportSchema,
  artifact: rawArtifactSchema.optional()
})

const rawVerificationSchema = z.object({
  valid: z.boolean(),
  agent_id: z.string(),
  content_hash: z.string(),
  signer_public_key: z.string()
})

async function responseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  let body: unknown = text
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : typeof body === 'string' && body
          ? body
          : `UAR catalog request failed with HTTP ${response.status}`
    throw new Error(message)
  }
  return body
}

async function adminRequest(path: string, init: RequestInit = {}): Promise<{ body: unknown; generation: number }> {
  const sidecar = application.get('UarSidecarService')
  const endpoint = await sidecar.ensureReady()
  const response = await sidecar.adminRequest(path, init, endpoint.generation)
  return { body: await responseBody(response), generation: endpoint.generation }
}

function projectArtifact(input: z.infer<typeof rawArtifactSchema>): UarAgentCatalogItem {
  const catalog = input.extensions['uar.catalog']
  const metadata =
    typeof catalog === 'object' && catalog !== null ? (catalog as { revision?: unknown; source?: unknown }) : undefined
  const source =
    typeof metadata?.source === 'object' && metadata.source !== null
      ? (metadata.source as { kind?: unknown; id?: unknown; revision?: unknown })
      : undefined
  return {
    id: input.id,
    title: input.metadata.title,
    description: input.metadata.description,
    version: input.version,
    revision: typeof metadata?.revision === 'string' ? metadata.revision : '',
    origin: {
      kind: typeof source?.kind === 'string' ? source.kind : 'unknown',
      id: typeof source?.id === 'string' ? source.id : input.id,
      ...(typeof source?.revision === 'string' ? { revision: source.revision } : {})
    },
    provider: input.policy.provider.default.provider,
    model: input.policy.provider.default.model,
    fallbackModels: input.policy.provider.fallbacks,
    skillIds: input.policy.skills.prefer,
    definition: input as Record<string, unknown>
  }
}

export async function readUarCatalog(): Promise<UarCatalogSnapshot> {
  const [{ body: catalog, generation }, { body: skills }, { body: provenance }] = await Promise.all([
    adminRequest('/api/uar/discovery/agents'),
    adminRequest('/api/uar/skills'),
    adminRequest('/api/uar/skills/provenance')
  ])
  const parsedCatalog = z
    .object({ runtime_agents: z.array(rawArtifactSchema), federated_agents: z.array(rawFederatedSchema) })
    .parse(catalog)
  const parsedProvenance = rawProvenanceSchema.parse(provenance)
  const agents = parsedCatalog.runtime_agents.map(projectArtifact)
  const bindings = await Promise.all(
    agents.map(async (agent) => {
      const { body } = await adminRequest(`/api/uar/agents/${encodeURIComponent(agent.id)}/skills`)
      return [agent.id, z.array(z.string()).parse(body)] as const
    })
  )
  const bindingsByAgent = new Map(bindings)
  const bossAgents = agentService.listAgents({ limit: 500 }).agents
  return {
    schemaVersion: 1,
    generation,
    agents: agents.map((agent) => {
      const linked = bossAgents.find(
        (candidate) =>
          (agent.origin.kind === 'the_boss' && candidate.id === agent.origin.id) ||
          candidate.configuration?.uar_catalog_link?.agentId === agent.id
      )
      return {
        ...agent,
        skillIds: bindingsByAgent.get(agent.id) ?? [],
        ...(linked
          ? { bossAgent: { id: linked.id, name: linked.name, ...(linked.model ? { modelId: linked.model } : {}) } }
          : {})
      }
    }),
    federatedAgents: parsedCatalog.federated_agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      baseUrl: agent.base_url,
      capabilities: agent.capabilities,
      updatedAt: agent.updated_at
    })),
    skills: z
      .array(rawSkillSchema)
      .parse(skills)
      .map((skill) => ({
        id: skill.skill_id,
        title: skill.title,
        description: skill.description,
        version: skill.version,
        enabled: skill.enabled,
        origin: typeof skill.origin === 'string' ? skill.origin : JSON.stringify(skill.origin),
        providerId: skill.provider_id
      })),
    skillProvenance: {
      loadedSkillCount: parsedProvenance.loaded_skill_count,
      ...(parsedProvenance.pack.skill_count === null ? {} : { packSkillCount: parsedProvenance.pack.skill_count }),
      ...(parsedProvenance.pack.commit ? { revision: parsedProvenance.pack.commit } : {}),
      ...(parsedProvenance.drift ? { drift: parsedProvenance.drift } : {})
    }
  }
}

export async function saveUarAgent(input: UarAgentSave): Promise<UarCatalogSnapshot> {
  const id = encodeURIComponent(input.id)
  await adminRequest(input.mode === 'create' ? '/api/agents' : `/api/agents/${id}`, {
    method: input.mode === 'create' ? 'POST' : 'PUT',
    headers: {
      'content-type': 'application/json',
      ...(input.mode === 'replace' && input.expectedRevision ? { 'if-match': input.expectedRevision } : {})
    },
    body: JSON.stringify(input.definition)
  })
  return readUarCatalog()
}

function presentationSelection(definition: Record<string, unknown>) {
  const extensions = definition.extensions
  const runPolicy =
    extensions && typeof extensions === 'object' && !Array.isArray(extensions)
      ? (extensions as Record<string, unknown>)['uar.run_policy']
      : undefined
  const presentations =
    runPolicy && typeof runPolicy === 'object' && !Array.isArray(runPolicy)
      ? (runPolicy as Record<string, unknown>).presentations
      : undefined
  return (
    uarPresentationSelectionSchema.safeParse(presentations).data ?? {
      mode: 'inherit' as const,
      ids: [],
      denied_ids: []
    }
  )
}

function promptSystem(definition: Record<string, unknown>): string {
  const prompt = definition.prompt
  if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) return 'You are a helpful, accurate assistant.'
  const system = (prompt as Record<string, unknown>).system
  return typeof system === 'string' && system.trim() ? system.trim() : 'You are a helpful, accurate assistant.'
}

/** Bind a registered catalog definition to a normal Boss Agent conversation.
 * Native UAR definitions remain catalog-authoritative; Boss-authored definitions
 * retain their existing conflict-aware synchronization contract. */
export async function prepareUarAgentRun(input: UarAgentRunTargetInput): Promise<UarAgentRunTarget> {
  const catalog = await readUarCatalog()
  const selected = catalog.agents.find((agent) => agent.id === input.agentId)
  if (!selected) throw new Error(`UAR catalog agent "${input.agentId}" is no longer available`)
  if (!selected.revision.startsWith('sha256:')) {
    throw new Error(`UAR catalog agent "${input.agentId}" has no executable revision`)
  }

  const assignment = {
    source: 'uar' as const,
    providerId: selected.provider,
    modelId: selected.model
  }
  const configuration = { uar_model_assignment: assignment }
  let bossAgent = selected.origin.kind === 'the_boss' ? agentService.getAgent(selected.origin.id) : undefined
  bossAgent ??= agentService
    .listAgents({ limit: 500 })
    .agents.find((agent) => agent.configuration?.uar_catalog_link?.agentId === selected.id)

  let created = false
  if (bossAgent) {
    if (bossAgent.type !== 'uar') {
      throw new Error(`The linked Boss agent "${bossAgent.name}" does not use the UAR runtime`)
    }
    const rawBossModelId = input.bossModelId ?? bossAgent.model
    if (!rawBossModelId) throw new Error(`Choose a Boss fallback model before running "${selected.title}"`)
    const bossModelId = UniqueModelIdSchema.parse(rawBossModelId)
    bossAgent =
      agentService.updateAgent(bossAgent.id, {
        name: selected.title,
        description: selected.description,
        instructions: promptSystem(selected.definition),
        model: bossModelId,
        configuration
      }) ?? undefined
    if (!bossAgent) throw new Error(`The linked Boss agent for "${selected.id}" is no longer available`)
  } else {
    if (!input.bossModelId) throw new Error(`Choose a Boss fallback model before running "${selected.title}"`)
    const bossModelId = UniqueModelIdSchema.parse(input.bossModelId)
    bossAgent = await createAgent({
      type: 'uar',
      name: selected.title,
      description: selected.description,
      instructions: promptSystem(selected.definition),
      model: bossModelId,
      configuration
    })
    created = true
  }

  if (selected.origin.kind !== 'the_boss' || selected.origin.id !== bossAgent.id) {
    bossAgent =
      agentService.updateUarCatalogLink(bossAgent.id, {
        schemaVersion: 1,
        agentId: selected.id,
        sourceRevision: selected.revision,
        catalogRevision: selected.revision,
        authority: 'catalog'
      }) ?? undefined
    if (!bossAgent) throw new Error(`The Boss agent for "${selected.id}" could not be linked to its catalog revision`)
  }

  return {
    bossAgentId: bossAgent.id,
    catalogAgentId: selected.id,
    catalogRevision: selected.revision,
    created,
    effectiveModel: {
      source: 'uar',
      providerId: selected.provider,
      modelId: selected.model,
      identity: `${selected.provider}/${selected.model}`
    },
    presentation: presentationSelection(selected.definition)
  }
}

export async function deleteUarAgent(id: string): Promise<UarCatalogSnapshot> {
  await adminRequest(`/api/agents/${encodeURIComponent(id)}`, { method: 'DELETE' })
  return readUarCatalog()
}

export async function compileUarAgent(input: UarCompilerRequest): Promise<UarCompilerResult> {
  const { body } = await adminRequest(
    input.register ? '/api/uar/compiler/compile-and-register' : '/api/uar/compiler/compile',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: input.content,
        ...(input.register ? { replace: input.replace, expected_revision: input.expectedRevision } : {})
      })
    }
  )
  const compiled = rawCompileSchema.parse(body)
  const { body: verificationBody } = await adminRequest('/api/uar/compiler/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ descriptor: compiled.descriptor, signature: compiled.signature })
  })
  const verification = rawVerificationSchema.parse(verificationBody)
  return {
    registered: input.register,
    ...(compiled.artifact ? { artifact: projectArtifact(compiled.artifact) } : {}),
    descriptor: compiled.descriptor,
    signature: compiled.signature,
    report: {
      id: compiled.report.id,
      agentId: compiled.report.agent_id,
      version: compiled.report.version,
      overall: compiled.report.overall,
      totalDurationMs: compiled.report.total_duration_ms,
      stages: compiled.report.stages.map((stage) => ({
        stage: stage.stage,
        name: stage.name,
        outcome: stage.outcome,
        durationMs: stage.duration_ms,
        diagnostics: stage.diagnostics
      }))
    },
    verification: {
      valid: verification.valid,
      agentId: verification.agent_id,
      contentHash: verification.content_hash,
      signerPublicKey: verification.signer_public_key
    }
  }
}

export async function saveUarAgentSkills(agentId: string, skillIds: string[]): Promise<UarCatalogSnapshot> {
  await adminRequest(`/api/uar/agents/${encodeURIComponent(agentId)}/skills`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ skill_ids: skillIds })
  })
  return readUarCatalog()
}

export async function toggleUarSkill(skillId: string, enabled: boolean): Promise<UarCatalogSnapshot> {
  await adminRequest(`/api/uar/skills/${encodeURIComponent(skillId)}/toggle`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled })
  })
  return readUarCatalog()
}

export async function refreshUarSkills(): Promise<UarCatalogSnapshot> {
  await adminRequest('/api/uar/skills/refresh', { method: 'POST' })
  return readUarCatalog()
}

export async function saveUarFederatedAgent(input: UarFederatedAgentSave): Promise<UarCatalogSnapshot> {
  await adminRequest('/a2a/registry/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: input.id,
      name: input.name,
      description: input.description,
      base_url: input.baseUrl,
      capabilities: input.capabilities
    })
  })
  return readUarCatalog()
}
