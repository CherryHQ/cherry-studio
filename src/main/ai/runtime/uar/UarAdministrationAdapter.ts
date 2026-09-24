import { randomUUID } from 'node:crypto'

import * as z from 'zod'

import { application } from '@application'
import {
  type UarAdministrationMethod,
  type UarAdministrationSnapshot,
  type UarAuthorityDiagnosticResult,
  type UarSettingChange,
  type UarSettingState,
  type UarSettingsNamespace,
  type UarSettingsSnapshot,
  type UarSettingsUpdateResult
} from '@shared/types/prometheusIntegration'

const rawSettingSchema = z.object({
  key: z.string().min(1),
  saved: z.unknown(),
  effective: z.unknown(),
  revision: z.string().min(1),
  source: z.string(),
  is_drift: z.boolean(),
  apply: z.enum(['live', 'next_turn', 'restart']),
  application_status: z.enum(['effective', 'pending', 'restart_required'])
})

const rawUpdateSchema = z.object({
  status: z.enum(['updated', 'partial']),
  updated: z.array(rawSettingSchema).default([]),
  errors: z
    .array(
      z.object({
        key: z.string(),
        code: z.string().default('write_failed'),
        error: z.string().optional(),
        expected_revision: z.string().optional(),
        current_revision: z.string().optional()
      })
    )
    .default([])
})

const rawGovernanceUpdateSchema = z.object({
  status: z.enum(['updated', 'partial']),
  results: z.array(
    z.object({
      key: z.string(),
      status: z.enum(['updated', 'validation_rejected', 'dependency_failed', 'skipped']),
      error: z.string().optional()
    })
  ),
  errors: rawUpdateSchema.shape.errors
})

const UAR_ADMIN_METHOD_ALLOWLIST = new Set<string>([
  'settings.types.list\u0000GET\u0000/api/uar/settings/types\u0000admin\u0000read',
  'settings.types.read\u0000GET\u0000/api/uar/settings/types/{key}\u0000admin\u0000read',
  'settings.types.create\u0000POST\u0000/api/uar/settings/types\u0000admin\u0000restart',
  'settings.list\u0000GET\u0000/api/uar/settings\u0000admin\u0000read',
  'settings.read\u0000GET\u0000/api/uar/settings/{key}\u0000admin\u0000read',
  'settings.update\u0000PUT\u0000/api/uar/settings/{key}\u0000admin\u0000next_turn',
  'settings.reset\u0000DELETE\u0000/api/uar/settings/{key}\u0000admin\u0000next_turn',
  'settings.drift\u0000GET\u0000/api/uar/settings/drift\u0000admin\u0000read',
  'settings.presentation_policy.read\u0000GET\u0000/api/uar/settings/presentation-policy\u0000admin\u0000read',
  'settings.presentation_policy.update\u0000PUT\u0000/api/uar/settings/presentation-policy\u0000admin\u0000next_turn',
  'settings.user.read\u0000GET\u0000/api/uar/user/settings\u0000owner\u0000read',
  'settings.user.update\u0000PUT\u0000/api/uar/user/settings\u0000owner\u0000next_turn',
  'settings.reload\u0000POST\u0000/.well-known/uar-config/reload\u0000admin\u0000live',
  'capabilities.read\u0000GET\u0000/api/uar/capabilities\u0000public\u0000read',
  'health.read\u0000GET\u0000/health\u0000public\u0000read',
  'health.compatibility.read\u0000GET\u0000/healthz\u0000public\u0000read',
  'readiness.read\u0000GET\u0000/readyz\u0000public\u0000read',
  'persistence.read\u0000GET\u0000/api/config/persistence\u0000admin\u0000read',
  'metrics.read\u0000GET\u0000/metrics\u0000admin\u0000read',
  'config.schema.read\u0000GET\u0000/.well-known/uar-config\u0000public\u0000read',
  'security.contact.read\u0000GET\u0000/.well-known/security.txt\u0000public\u0000read',
  'providers.list\u0000GET\u0000/api/uar/providers\u0000admin\u0000read',
  'providers.enabled\u0000GET\u0000/api/uar/providers/enabled\u0000admin\u0000read',
  'providers.health\u0000GET\u0000/api/uar/providers/health\u0000admin\u0000read',
  'providers.create\u0000POST\u0000/api/uar/providers\u0000admin\u0000live',
  'providers.read\u0000GET\u0000/api/uar/providers/{id}\u0000admin\u0000read',
  'providers.update\u0000PUT\u0000/api/uar/providers/{id}\u0000admin\u0000live',
  'providers.delete\u0000DELETE\u0000/api/uar/providers/{id}\u0000admin\u0000live',
  'providers.models\u0000GET\u0000/api/uar/providers/{id}/models\u0000admin\u0000read',
  'providers.test\u0000POST\u0000/api/uar/providers/{id}/test\u0000admin\u0000read',
  'providers.default\u0000POST\u0000/api/uar/providers/{id}/default\u0000admin\u0000next_turn',
  'models.list\u0000GET\u0000/api/models\u0000admin\u0000read',
  'models.catalog\u0000GET\u0000/api/catalog\u0000admin\u0000read',
  'models.resolve\u0000GET\u0000/api/uar/resolve-model\u0000owner\u0000read',
  'models.route\u0000POST\u0000/api/uar/route\u0000owner\u0000read',
  'models.openai.list\u0000GET\u0000/v1/models\u0000owner\u0000read',
  'models.openai.read\u0000GET\u0000/v1/models/{model_id}\u0000owner\u0000read',
  'agents.list\u0000GET\u0000/api/agents\u0000admin\u0000read',
  'agents.create\u0000POST\u0000/api/agents\u0000admin\u0000live',
  'agents.read\u0000GET\u0000/api/agents/{id}\u0000admin\u0000read',
  'agents.replace\u0000PUT\u0000/api/agents/{id}\u0000admin\u0000next_turn',
  'agents.patch\u0000PATCH\u0000/api/agents/{id}\u0000admin\u0000next_turn',
  'agents.delete\u0000DELETE\u0000/api/agents/{id}\u0000admin\u0000next_turn',
  'agents.discovery\u0000GET\u0000/api/uar/discovery/agents\u0000owner\u0000read',
  'agents.discovery.current\u0000GET\u0000/api/uar/discovery/sessions/{session_id}/agent\u0000owner\u0000read',
  'compiler.specs.list\u0000GET\u0000/api/uar/compiler/specs\u0000admin\u0000read',
  'compiler.specs.create\u0000POST\u0000/api/uar/compiler/specs\u0000admin\u0000live',
  'compiler.specs.read\u0000GET\u0000/api/uar/compiler/specs/{id}\u0000admin\u0000read',
  'compiler.specs.delete\u0000DELETE\u0000/api/uar/compiler/specs/{id}\u0000admin\u0000live',
  'compiler.specs.compile\u0000POST\u0000/api/uar/compiler/specs/{id}/compile\u0000admin\u0000read',
  'compiler.compile\u0000POST\u0000/api/uar/compiler/compile\u0000admin\u0000read',
  'compiler.register\u0000POST\u0000/api/uar/compiler/compile-and-register\u0000admin\u0000live',
  'compiler.verify\u0000POST\u0000/api/uar/compiler/verify\u0000admin\u0000read',
  'compiler.reports.read\u0000GET\u0000/api/uar/compiler/reports/{id}\u0000admin\u0000read',
  'compiler.sessions.list\u0000GET\u0000/api/uar/compiler/sessions\u0000admin\u0000read',
  'compiler.sessions.create\u0000POST\u0000/api/uar/compiler/sessions\u0000admin\u0000live',
  'compiler.sessions.read\u0000GET\u0000/api/uar/compiler/sessions/{id}\u0000admin\u0000read',
  'compiler.sessions.cancel\u0000POST\u0000/api/uar/compiler/sessions/{id}/cancel\u0000admin\u0000live',
  'compiler.sessions.compile\u0000POST\u0000/api/uar/compiler/sessions/{id}/compile\u0000admin\u0000live',
  'skills.list\u0000GET\u0000/api/uar/skills\u0000admin\u0000read',
  'skills.create\u0000POST\u0000/api/uar/skills\u0000admin\u0000live',
  'skills.read\u0000GET\u0000/api/uar/skills/{id}\u0000admin\u0000read',
  'skills.update\u0000PUT\u0000/api/uar/skills/{id}\u0000admin\u0000next_turn',
  'skills.delete\u0000DELETE\u0000/api/uar/skills/{id}\u0000admin\u0000next_turn',
  'skills.toggle\u0000POST\u0000/api/uar/skills/{id}/toggle\u0000admin\u0000next_turn',
  'skills.match\u0000GET\u0000/api/uar/skills/match\u0000owner\u0000read',
  'skills.provenance\u0000GET\u0000/api/uar/skills/provenance\u0000admin\u0000read',
  'skills.update_check\u0000GET\u0000/api/uar/skills/update-check\u0000admin\u0000read',
  'skills.update_pack\u0000POST\u0000/api/uar/skills/update\u0000host\u0000host_controlled',
  'skills.refresh\u0000POST\u0000/api/uar/skills/refresh\u0000admin\u0000live',
  'skills.import\u0000POST\u0000/api/uar/skills/import\u0000host\u0000host_controlled',
  'skills.config.read\u0000GET\u0000/api/uar/skills/config\u0000admin\u0000read',
  'skills.config.update\u0000PUT\u0000/api/uar/skills/config\u0000admin\u0000next_turn',
  'skills.agent.read\u0000GET\u0000/api/uar/agents/{id}/skills\u0000admin\u0000read',
  'skills.agent.update\u0000PUT\u0000/api/uar/agents/{id}/skills\u0000admin\u0000next_turn',
  'skills.agent.add\u0000POST\u0000/api/uar/agents/{id}/skills/{skill_id}\u0000admin\u0000next_turn',
  'skills.agent.remove\u0000DELETE\u0000/api/uar/agents/{id}/skills/{skill_id}\u0000admin\u0000next_turn',
  'skills.discovery\u0000GET\u0000/api/uar/discovery/skills\u0000owner\u0000read',
  'skills.reload\u0000POST\u0000/api/uar/skills/reload\u0000host\u0000host_controlled',
  'presentations.list\u0000GET\u0000/api/uar/presentations\u0000owner\u0000read',
  'presentations.create\u0000POST\u0000/api/uar/presentations\u0000owner\u0000live',
  'presentations.read\u0000GET\u0000/api/uar/presentations/{id}\u0000owner\u0000read',
  'presentations.update\u0000PUT\u0000/api/uar/presentations/{id}\u0000owner\u0000next_turn',
  'presentations.delete\u0000DELETE\u0000/api/uar/presentations/{id}\u0000owner\u0000next_turn',
  'a2ui.schemas.list\u0000GET\u0000/api/uar/a2ui/schemas\u0000owner\u0000read',
  'a2ui.schemas.read\u0000GET\u0000/api/uar/a2ui/schemas/{id}\u0000owner\u0000read',
  'a2ui.components.list\u0000GET\u0000/api/uar/a2ui/components\u0000owner\u0000read',
  'a2ui.components.promote\u0000POST\u0000/api/uar/a2ui/components\u0000admin\u0000live',
  'a2ui.artifact_response\u0000POST\u0000/api/uar/runs/{id}/artifact-response\u0000owner\u0000live',
  'a2ui.surface_replay\u0000GET\u0000/api/uar/runs/{id}/a2ui/surface-replay\u0000owner\u0000read',
  'a2ui.messages.submit\u0000POST\u0000/api/uar/runs/{id}/a2ui/messages\u0000owner\u0000live',
  'a2ui.actions.submit\u0000POST\u0000/api/uar/runs/{id}/a2ui/actions\u0000owner\u0000live',
  'runs.create\u0000POST\u0000/api/uar/runs\u0000owner\u0000live',
  'runs.stream\u0000GET\u0000/api/uar/runs/{id}/stream\u0000owner\u0000live',
  'runs.cancel\u0000POST\u0000/api/uar/runs/{id}/cancel\u0000owner\u0000live',
  'runs.approve\u0000POST\u0000/api/uar/runs/{id}/tool-approval\u0000owner\u0000live',
  'runs.checkpoints\u0000GET\u0000/api/uar/runs/{id}/checkpoints\u0000owner\u0000read',
  'runs.resume\u0000POST\u0000/api/uar/runs/{id}/resume\u0000owner\u0000live',
  'runs.resume_checkpoint\u0000POST\u0000/api/uar/runs/{id}/resume/{checkpoint_id}\u0000owner\u0000live',
  'runs.mcp_grant.revoke\u0000POST\u0000/api/uar/runs/{id}/mcp-grants/{server}/revoke\u0000owner\u0000live',
  'runs.approval\u0000POST\u0000/api/uar/runs/{id}/approval\u0000owner\u0000live',
  'sessions.cancel\u0000POST\u0000/api/uar/sessions/{id}/cancel\u0000owner\u0000live',
  'sessions.context_stats\u0000GET\u0000/api/uar/sessions/{id}/context-stats\u0000owner\u0000read',
  'sessions.agent_config.read\u0000GET\u0000/api/uar/sessions/{id}/agent-config\u0000owner\u0000read',
  'sessions.agent_config.update\u0000POST\u0000/api/uar/sessions/{id}/agent-config\u0000owner\u0000next_turn',
  'sessions.effective_config\u0000GET\u0000/api/uar/sessions/{id}/effective-config\u0000owner\u0000read',
  'sessions.prompt_caching\u0000GET\u0000/api/uar/sessions/{id}/prompt-caching\u0000owner\u0000read',
  'conversations.policy.read\u0000GET\u0000/api/uar/conversations/{id}/policy\u0000owner\u0000read',
  'conversations.policy.update\u0000PUT\u0000/api/uar/conversations/{id}/policy\u0000owner\u0000next_turn',
  'conversations.policy.reset\u0000DELETE\u0000/api/uar/conversations/{id}/policy\u0000owner\u0000next_turn',
  'actors.list\u0000GET\u0000/api/uar/actors\u0000owner\u0000read',
  'actors.spawn\u0000POST\u0000/api/uar/actors\u0000owner\u0000live',
  'actors.stop\u0000DELETE\u0000/api/uar/actors/{id}\u0000owner\u0000live',
  'actors.message\u0000POST\u0000/api/uar/actors/{id}/message\u0000owner\u0000live',
  'actors.collaborate\u0000POST\u0000/api/uar/actors/{id}/collaborate\u0000owner\u0000live',
  'knowledge.list\u0000GET\u0000/api/uar/knowledge-bases\u0000owner\u0000read',
  'knowledge.create\u0000POST\u0000/api/uar/knowledge-bases\u0000owner\u0000live',
  'knowledge.read\u0000GET\u0000/api/uar/knowledge-bases/{id}\u0000owner\u0000read',
  'knowledge.update\u0000PUT\u0000/api/uar/knowledge-bases/{id}\u0000owner\u0000live',
  'knowledge.delete\u0000DELETE\u0000/api/uar/knowledge-bases/{id}\u0000owner\u0000live',
  'knowledge.documents\u0000GET\u0000/api/uar/knowledge-bases/{id}/documents\u0000owner\u0000read',
  'knowledge.upload\u0000POST\u0000/api/uar/knowledge-bases/{id}/documents\u0000owner\u0000live',
  'knowledge.document.read\u0000GET\u0000/api/uar/knowledge-bases/{id}/documents/{doc_id}\u0000owner\u0000read',
  'knowledge.document.delete\u0000DELETE\u0000/api/uar/knowledge-bases/{id}/documents/{doc_id}\u0000owner\u0000live',
  'knowledge.search\u0000POST\u0000/api/uar/knowledge-bases/{id}/search\u0000owner\u0000read',
  'memory.admin.list\u0000GET\u0000/api/admin/memories\u0000admin\u0000read',
  'memory.admin.create\u0000POST\u0000/api/admin/memories\u0000admin\u0000live',
  'memory.admin.bulk_delete\u0000DELETE\u0000/api/admin/memories\u0000admin\u0000live',
  'memory.admin.stats\u0000GET\u0000/api/admin/memories/stats\u0000admin\u0000read',
  'memory.admin.search\u0000GET\u0000/api/admin/memories/search\u0000admin\u0000read',
  'memory.admin.read\u0000GET\u0000/api/admin/memories/{id}\u0000admin\u0000read',
  'memory.admin.update\u0000PATCH\u0000/api/admin/memories/{id}\u0000admin\u0000live',
  'memory.admin.delete\u0000DELETE\u0000/api/admin/memories/{id}\u0000admin\u0000live',
  'memory.search\u0000GET\u0000/api/memory\u0000owner\u0000read',
  'memory.save\u0000POST\u0000/api/memory\u0000owner\u0000live',
  'tools.list\u0000GET\u0000/api/tools\u0000owner\u0000read',
  'tools.execute\u0000POST\u0000/api/tools/{name}/execute\u0000owner\u0000live',
  'tools.discovery\u0000GET\u0000/api/uar/discovery/tools\u0000owner\u0000read',
  'mcp.health\u0000GET\u0000/api/uar/mcp/health\u0000admin\u0000read',
  'mcp.servers.list\u0000GET\u0000/api/uar/mcp/servers\u0000admin\u0000read',
  'mcp.servers.save\u0000PUT\u0000/api/uar/mcp/servers/{name}\u0000host\u0000host_controlled',
  'mcp.servers.delete\u0000DELETE\u0000/api/uar/mcp/servers/{name}\u0000host\u0000host_controlled',
  'auth.keys.list\u0000GET\u0000/api/uar/auth/keys\u0000admin\u0000read',
  'auth.keys.create\u0000POST\u0000/api/uar/auth/keys\u0000admin\u0000live',
  'auth.keys.revoke\u0000DELETE\u0000/api/uar/auth/keys/{id}\u0000admin\u0000live',
  'auth.keys.exchange\u0000POST\u0000/api/uar/auth/exchange\u0000owner\u0000live',
  'credentials.list\u0000GET\u0000/api/uar/credentials\u0000owner\u0000read',
  'credentials.set\u0000PUT\u0000/api/uar/credentials/{provider}\u0000owner\u0000live',
  'credentials.clear\u0000DELETE\u0000/api/uar/credentials/{provider}\u0000owner\u0000live',
  'governance.status\u0000GET\u0000/api/uar/settings/governance/status\u0000admin\u0000read',
  'protocols.a2a.card\u0000GET\u0000/.well-known/agent.json\u0000public\u0000read',
  'protocols.a2a.agents\u0000GET\u0000/a2a/registry/agents\u0000admin\u0000read',
  'protocols.a2a.agent\u0000GET\u0000/a2a/registry/agents/{id}\u0000admin\u0000read',
  'protocols.a2a.register\u0000POST\u0000/a2a/registry/register\u0000admin\u0000live',
  'protocols.a2a.skills\u0000GET\u0000/a2a/registry/skills\u0000admin\u0000read',
  'protocols.a2a.rpc\u0000POST\u0000/a2a/agents/{agent_id}\u0000owner\u0000live',
  'protocols.a2a.compiler\u0000POST\u0000/a2a/compiler\u0000owner\u0000live',
  'protocols.acp.connect\u0000POST\u0000/acp\u0000owner\u0000live',
  'protocols.acp.stream\u0000POST\u0000/acp/stream\u0000owner\u0000live',
  'diagnostics.live\u0000GET\u0000/api/live\u0000admin\u0000live',
  'diagnostics.live.topic\u0000GET\u0000/api/live/{topic}\u0000admin\u0000live',
  'diagnostics.sync\u0000GET\u0000/api/uar/sync/stream\u0000admin\u0000live',
  'diagnostics.chat\u0000POST\u0000/api/chat/completion\u0000owner\u0000live',
  'diagnostics.title\u0000POST\u0000/api/generate-title\u0000owner\u0000live',
  'diagnostics.upload\u0000POST\u0000/api/upload\u0000owner\u0000live',
  'diagnostics.attachment\u0000GET\u0000/api/attachments/{id}\u0000owner\u0000read',
  'diagnostics.ingest\u0000POST\u0000/api/ingest\u0000owner\u0000live',
  'diagnostics.openai\u0000POST\u0000/v1/chat/completions\u0000owner\u0000live',
  'diagnostics.anthropic\u0000POST\u0000/v1/messages\u0000owner\u0000live',
  'legacy.chat\u0000ANY\u0000/api/chat\u0000public\u0000unavailable',
  'legacy.sessions\u0000ANY\u0000/api/sessions\u0000public\u0000unavailable',
  'settings.namespace.server.read\u0000GET\u0000/api/uar/settings/server\u0000admin\u0000read',
  'settings.namespace.server.update\u0000PUT\u0000/api/uar/settings/server\u0000admin\u0000restart',
  'settings.namespace.security.read\u0000GET\u0000/api/uar/settings/security\u0000admin\u0000read',
  'settings.namespace.security.update\u0000PUT\u0000/api/uar/settings/security\u0000admin\u0000restart',
  'settings.namespace.resilience.read\u0000GET\u0000/api/uar/settings/resilience\u0000admin\u0000read',
  'settings.namespace.resilience.update\u0000PUT\u0000/api/uar/settings/resilience\u0000admin\u0000next_turn',
  'settings.namespace.persistence.read\u0000GET\u0000/api/uar/settings/persistence\u0000admin\u0000read',
  'settings.namespace.persistence.update\u0000PUT\u0000/api/uar/settings/persistence\u0000admin\u0000restart',
  'settings.namespace.file_processing.read\u0000GET\u0000/api/uar/settings/file-processing\u0000admin\u0000read',
  'settings.namespace.file_processing.update\u0000PUT\u0000/api/uar/settings/file-processing\u0000admin\u0000next_turn',
  'settings.namespace.vision.read\u0000GET\u0000/api/uar/settings/vision\u0000admin\u0000read',
  'settings.namespace.vision.update\u0000PUT\u0000/api/uar/settings/vision\u0000admin\u0000next_turn',
  'settings.namespace.models.read\u0000GET\u0000/api/uar/settings/models\u0000admin\u0000read',
  'settings.namespace.models.update\u0000PUT\u0000/api/uar/settings/models\u0000admin\u0000next_turn',
  'settings.namespace.knowledge_bases.read\u0000GET\u0000/api/uar/settings/knowledge-bases\u0000admin\u0000read',
  'settings.namespace.knowledge_bases.update\u0000PUT\u0000/api/uar/settings/knowledge-bases\u0000admin\u0000next_turn',
  'settings.namespace.intent_classifier.read\u0000GET\u0000/api/uar/settings/intent-classifier\u0000admin\u0000read',
  'settings.namespace.intent_classifier.update\u0000PUT\u0000/api/uar/settings/intent-classifier\u0000admin\u0000next_turn',
  'settings.namespace.providers.read\u0000GET\u0000/api/uar/settings/providers\u0000admin\u0000read',
  'settings.namespace.providers.update\u0000PUT\u0000/api/uar/settings/providers\u0000admin\u0000next_turn',
  'settings.namespace.llm.read\u0000GET\u0000/api/uar/settings/llm\u0000admin\u0000read',
  'settings.namespace.llm.update\u0000PUT\u0000/api/uar/settings/llm\u0000admin\u0000next_turn',
  'settings.namespace.unstructured.read\u0000GET\u0000/api/uar/settings/unstructured\u0000admin\u0000read',
  'settings.namespace.unstructured.update\u0000PUT\u0000/api/uar/settings/unstructured\u0000admin\u0000next_turn',
  'settings.namespace.kreuzberg.read\u0000GET\u0000/api/uar/settings/kreuzberg\u0000admin\u0000read',
  'settings.namespace.kreuzberg.update\u0000PUT\u0000/api/uar/settings/kreuzberg\u0000admin\u0000next_turn',
  'settings.namespace.context_management.read\u0000GET\u0000/api/uar/settings/context-management\u0000admin\u0000read',
  'settings.namespace.context_management.update\u0000PUT\u0000/api/uar/settings/context-management\u0000admin\u0000next_turn',
  'settings.namespace.context_strategy.read\u0000GET\u0000/api/uar/settings/context-strategy\u0000admin\u0000read',
  'settings.namespace.context_strategy.update\u0000PUT\u0000/api/uar/settings/context-strategy\u0000admin\u0000next_turn',
  'settings.namespace.prompt_caching.read\u0000GET\u0000/api/uar/settings/prompt-caching\u0000admin\u0000read',
  'settings.namespace.prompt_caching.update\u0000PUT\u0000/api/uar/settings/prompt-caching\u0000admin\u0000next_turn',
  'settings.namespace.rag.read\u0000GET\u0000/api/uar/settings/rag\u0000admin\u0000read',
  'settings.namespace.rag.update\u0000PUT\u0000/api/uar/settings/rag\u0000admin\u0000next_turn',
  'settings.namespace.governance.read\u0000GET\u0000/api/uar/settings/governance\u0000admin\u0000read',
  'settings.namespace.governance.update\u0000PUT\u0000/api/uar/settings/governance\u0000admin\u0000live',
  'settings.namespace.agent_config.read\u0000GET\u0000/api/uar/settings/agent-config\u0000admin\u0000read',
  'settings.namespace.agent_config.update\u0000PUT\u0000/api/uar/settings/agent-config\u0000admin\u0000next_turn',
  'settings.namespace.skill_config.read\u0000GET\u0000/api/uar/settings/skill-config\u0000admin\u0000read',
  'settings.namespace.skill_config.update\u0000PUT\u0000/api/uar/settings/skill-config\u0000admin\u0000next_turn',
  'settings.namespace.mistral_ocr.read\u0000GET\u0000/api/uar/settings/mistral-ocr\u0000admin\u0000read',
  'settings.namespace.mistral_ocr.update\u0000PUT\u0000/api/uar/settings/mistral-ocr\u0000admin\u0000next_turn',
  'settings.namespace.memory.read\u0000GET\u0000/api/uar/settings/memory\u0000admin\u0000read',
  'settings.namespace.memory.update\u0000PUT\u0000/api/uar/settings/memory\u0000admin\u0000next_turn',
  'settings.namespace.llm_failover.read\u0000GET\u0000/api/uar/settings/llm-failover\u0000admin\u0000read',
  'settings.namespace.llm_failover.update\u0000PUT\u0000/api/uar/settings/llm-failover\u0000admin\u0000next_turn',
  'settings.namespace.sandbox.read\u0000GET\u0000/api/uar/settings/sandbox\u0000admin\u0000read',
  'settings.namespace.sandbox.update\u0000PUT\u0000/api/uar/settings/sandbox\u0000admin\u0000next_turn',
  'settings.namespace.native_tools.read\u0000GET\u0000/api/uar/settings/native-tools\u0000admin\u0000read',
  'settings.namespace.native_tools.update\u0000PUT\u0000/api/uar/settings/native-tools\u0000admin\u0000next_turn',
  'settings.namespace.skill_evolution.read\u0000GET\u0000/api/uar/settings/skill-evolution\u0000admin\u0000read',
  'settings.namespace.skill_evolution.update\u0000PUT\u0000/api/uar/settings/skill-evolution\u0000admin\u0000next_turn',
  'settings.namespace.sycophancy.read\u0000GET\u0000/api/uar/settings/sycophancy\u0000admin\u0000read',
  'settings.namespace.sycophancy.update\u0000PUT\u0000/api/uar/settings/sycophancy\u0000admin\u0000next_turn',
  'settings.namespace.acp.read\u0000GET\u0000/api/uar/settings/acp\u0000admin\u0000read',
  'settings.namespace.acp.update\u0000PUT\u0000/api/uar/settings/acp\u0000admin\u0000next_turn'
])

function isAllowed(method: UarAdministrationMethod): boolean {
  return UAR_ADMIN_METHOD_ALLOWLIST.has(
    [method.id, method.method, method.path, method.scope, method.apply].join('\u0000')
  )
}

/**
 * Project the sidecar manifest through The Boss's closed method/path/scope/apply allowlist.
 * Renderer code receives operation metadata, never an arbitrary fetch surface.
 */
export async function readUarAdministrationSnapshot(): Promise<UarAdministrationSnapshot> {
  const endpoint = await application.get('UarSidecarService').ensureReady()
  return {
    schemaVersion: 1,
    uarVersion: endpoint.uarVersion,
    generation: endpoint.generation,
    surfaces: endpoint.administration.surfaces.map((surface) => ({
      ...surface,
      methods: surface.methods.map((method) => ({
        ...method,
        adapter: isAllowed(method) ? 'available' : 'unavailable'
      }))
    }))
  }
}

const ownerSettingsSchema = z.object({
  user_id: z.string(),
  prompt_caching_enabled: z.boolean().nullable()
})

async function readOwnerSettings(response: Response): Promise<z.infer<typeof ownerSettingsSchema> | undefined> {
  if (!response.ok) return undefined
  return ownerSettingsSchema.parse(await response.json())
}

/** Exercise the real sidecar authority boundaries without disclosing either
 * protected authority or owner tokens to the renderer. */
export async function diagnoseUarAuthority(): Promise<UarAuthorityDiagnosticResult> {
  const sidecar = application.get('UarSidecarService')
  const endpoint = await sidecar.ensureReady()
  const suffix = randomUUID()
  const ownerA = `diagnostics.owner.a-${suffix}`
  const ownerB = `diagnostics.owner.b-${suffix}`
  const ownerUpdate = {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt_caching_enabled: true })
  }
  const ownerReset = {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt_caching_enabled: null })
  }

  const unprivilegedAdmin = await sidecar.request('/api/uar/providers', ownerA, {}, endpoint.generation)
  const privilegedAdmin = await sidecar.adminRequest('/api/uar/providers', {}, endpoint.generation)
  const writeOwnerA = await sidecar.request('/api/uar/user/settings', ownerA, ownerUpdate, endpoint.generation)
  const readOwnerAResponse = await sidecar.request('/api/uar/user/settings', ownerA, {}, endpoint.generation)
  const readOwnerA = await readOwnerSettings(readOwnerAResponse)
  const readOwnerBResponse = await sidecar.request('/api/uar/user/settings', ownerB, {}, endpoint.generation)
  const readOwnerB = await readOwnerSettings(readOwnerBResponse)
  await sidecar.request('/api/uar/user/settings', ownerA, ownerReset, endpoint.generation).catch(() => undefined)

  const adminBoundary = unprivilegedAdmin.status === 401 && privilegedAdmin.ok
  const ownerIsolation =
    writeOwnerA.ok &&
    readOwnerA?.user_id === ownerA &&
    readOwnerA.prompt_caching_enabled === true &&
    readOwnerB?.user_id === ownerB &&
    readOwnerB.prompt_caching_enabled === null

  return {
    schemaVersion: 1,
    generation: endpoint.generation,
    diagnostics: [
      {
        id: 'uar-admin-authority',
        state: adminBoundary ? 'operational' : 'failed',
        detail: `owner HTTP ${unprivilegedAdmin.status}; protected admin HTTP ${privilegedAdmin.status}`
      },
      {
        id: 'uar-owner-isolation',
        state: ownerIsolation ? 'operational' : 'failed',
        detail: ownerIsolation
          ? 'separate owner settings remained isolated'
          : `write HTTP ${writeOwnerA.status}; owner A read HTTP ${readOwnerAResponse.status}, identity ${readOwnerA?.user_id === ownerA ? 'matched' : 'mismatched'}, value ${String(readOwnerA?.prompt_caching_enabled)}; owner B read HTTP ${readOwnerBResponse.status}, identity ${readOwnerB?.user_id === ownerB ? 'matched' : 'mismatched'}, value ${String(readOwnerB?.prompt_caching_enabled)}`
      }
    ]
  }
}

function projectSetting(setting: z.infer<typeof rawSettingSchema>): UarSettingState {
  return {
    key: setting.key,
    field: setting.key.split('.').slice(1).join('.'),
    saved: setting.saved,
    effective: setting.effective,
    revision: setting.revision,
    source: setting.source,
    drift: setting.is_drift,
    apply: setting.apply,
    applicationStatus: setting.application_status
  }
}

async function parseResponse(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `UAR administration request failed with HTTP ${response.status}`
    throw new Error(message)
  }
  return body
}

export async function readUarSettings(namespace: UarSettingsNamespace): Promise<UarSettingsSnapshot> {
  const sidecar = application.get('UarSidecarService')
  const endpoint = await sidecar.ensureReady()
  const response = await sidecar.adminRequest(`/api/uar/settings/${namespace}`, {}, endpoint.generation)
  const settings = z
    .array(rawSettingSchema)
    .parse(await parseResponse(response))
    .map(projectSetting)
  return { schemaVersion: 1, namespace, generation: endpoint.generation, settings }
}

export async function updateUarSettings(
  namespace: UarSettingsNamespace,
  changes: UarSettingChange[]
): Promise<UarSettingsUpdateResult> {
  if (new Set(changes.map((change) => change.field)).size !== changes.length) {
    throw new Error('A UAR setting field may only appear once per update')
  }
  const sidecar = application.get('UarSidecarService')
  const endpoint = await sidecar.ensureReady()
  const data = Object.fromEntries(changes.map((change) => [change.field, change.value]))
  const expected_revisions = Object.fromEntries(changes.map((change) => [change.field, change.expectedRevision]))
  const response = await sidecar.adminRequest(
    `/api/uar/settings/${namespace}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data, expected_revisions })
    },
    endpoint.generation
  )
  const body = await parseResponse(response)
  if (namespace === 'governance') {
    const result = rawGovernanceUpdateSchema.parse(body)
    const snapshot = await readUarSettings(namespace)
    const updatedKeys = new Set(result.results.filter((item) => item.status === 'updated').map((item) => item.key))
    const mutationErrors = result.results
      .filter((item) => item.status !== 'updated')
      .map((item) => ({
        key: item.key,
        code: item.status,
        ...(item.error ? { message: item.error } : {})
      }))
    return {
      status: result.status,
      namespace,
      generation: endpoint.generation,
      updated: snapshot.settings.filter((setting) => updatedKeys.has(setting.key)),
      errors: [
        ...result.errors.map((error) => ({
          key: error.key,
          code: error.code,
          ...(error.error ? { message: error.error } : {}),
          ...(error.expected_revision ? { expectedRevision: error.expected_revision } : {}),
          ...(error.current_revision ? { currentRevision: error.current_revision } : {})
        })),
        ...mutationErrors
      ]
    }
  }
  const result = rawUpdateSchema.parse(body)
  return {
    status: result.status,
    namespace,
    generation: endpoint.generation,
    updated: result.updated.map(projectSetting),
    errors: result.errors.map((error) => ({
      key: error.key,
      code: error.code,
      ...(error.error ? { message: error.error } : {}),
      ...(error.expected_revision ? { expectedRevision: error.expected_revision } : {}),
      ...(error.current_revision ? { currentRevision: error.current_revision } : {})
    }))
  }
}
