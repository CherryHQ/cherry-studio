import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { type ClaudeToolContext, resolveDisallowedTools } from '@main/ai/tools/adapters/claudeCode/toolConditions'
import { claudeRegistrySdkDescriptors } from '@shared/ai/claudecode/toolRegistry'
import {
  buildClaudeMcpToolName,
  type ClaudeToolDecision,
  type ClaudeToolDescriptor,
  type ClaudeToolPolicy,
  normalizeClaudeBuiltinName,
  resolveClaudeToolAccess,
  resolveClaudeToolInvocationAccess
} from '@shared/ai/claudecode/toolRules'
import type { Tool } from '@shared/ai/tool'
import { resolveMcpSourceToolAccess } from '@shared/ai/tools/mcpSourcePolicy'
import { toSdkMcpServerSegment, translateLegacyMcpToolRules } from '@shared/ai/tools/mcpToolName'
import type { AgentEntity, AgentPermissionMode } from '@shared/data/api/schemas/agents'

function sanitizeDescription(value: string): string {
  let out = ''
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      out += value[i]
      continue
    }
    if ((code >= 0x00 && code <= 0x1f) || code === 0x7f) continue
    out += value[i]
  }
  return out
}

const logger = loggerService.withContext('ClaudeCodeAgentTools')

export function descriptorToTool(descriptor: ClaudeToolDescriptor, policy: ClaudeToolPolicy): Tool {
  const access = resolveClaudeToolAccess(descriptor, policy)
  return descriptorToToolWithAccess(descriptor, access)
}

function descriptorToToolWithAccess(descriptor: ClaudeToolDescriptor, access: ClaudeToolDecision): Tool {
  return {
    id: descriptor.id,
    name: descriptor.name,
    description: descriptor.description,
    origin: descriptor.origin,
    approval: access.approval,
    sourceId: descriptor.sourceId,
    sourceName: descriptor.sourceName
  }
}

export function buildClaudeToolPolicy(agent: Partial<Pick<AgentEntity, 'configuration'>>): ClaudeToolPolicy {
  return {
    permissionMode: agent.configuration?.permission_mode
  }
}

async function listMcpDescriptors(mcpIds: readonly string[]): Promise<{
  descriptors: ClaudeToolDescriptor[]
  failedMcpIds: Set<string>
}> {
  if (mcpIds.length === 0) return { descriptors: [], failedMcpIds: new Set() }

  const descriptors: ClaudeToolDescriptor[] = []
  const failedMcpIds = new Set<string>()

  for (const id of mcpIds) {
    // `agent.mcps` entries may be a server id or a name (matching buildMcpServers / buildMcpToolMetadata).
    // A genuinely unknown/deleted server is skipped — not marked failed, so it can't spuriously trigger
    // the carry-forward of stale descriptors reserved for transient listTools fetch failures below.
    const server = mcpServerService.findByIdOrName(id)
    if (!server) continue
    try {
      const tools = application.get('McpCatalogService').listTools(server.id)

      for (const tool of tools) {
        const sourceAccess = resolveMcpSourceToolAccess(server, tool)
        if (!sourceAccess.enabled) continue
        descriptors.push({
          id: buildClaudeMcpToolName(server.name, tool.name),
          name: tool.name,
          description: sanitizeDescription(tool.description || ''),
          origin: 'mcp',
          sourceId: server.id,
          sourceName: server.name,
          sourceToolName: tool.name,
          sourceApproval: sourceAccess.approval
        })
      }
    } catch (error) {
      // Key by the resolved server.id, not the raw entry: the carry-forward in rebuild() matches
      // failedMcpIds against prior descriptors' sourceId (server.id), so a name-referenced entry keyed
      // by its name would lose its approvals on a transient failure instead of preserving them.
      failedMcpIds.add(server.id)
      logger.warn('Failed to list MCP tools for agent catalog', { id, serverId: server.id, error })
    }
  }

  return { descriptors, failedMcpIds }
}

export async function listClaudeAgentToolDescriptors(agent: Pick<AgentEntity, 'mcps'>): Promise<{
  descriptors: ClaudeToolDescriptor[]
  failedMcpIds: Set<string>
}> {
  const mcpCatalog = await listMcpDescriptors(agent.mcps ?? [])
  return {
    descriptors: [...claudeRegistrySdkDescriptors(), ...mcpCatalog.descriptors],
    failedMcpIds: mcpCatalog.failedMcpIds
  }
}

export async function listClaudeAgentTools(agent: AgentEntity): Promise<Tool[]> {
  const { descriptors } = await listClaudeAgentToolDescriptors(agent)
  const policy = buildClaudeToolPolicy(agent)
  return descriptors.map((descriptor) => descriptorToTool(descriptor, policy))
}

function findRuntimeDescriptor(
  descriptors: readonly ClaudeToolDescriptor[],
  runtimeName: string
): ClaudeToolDescriptor | undefined {
  const normalizedRuntimeName = normalizeClaudeBuiltinName(runtimeName)
  return descriptors.find(
    (item) =>
      item.id === runtimeName ||
      normalizeClaudeBuiltinName(item.id) === normalizedRuntimeName ||
      item.name === normalizedRuntimeName
  )
}

function injectedRuntimeTool(runtimeName: string): Tool {
  return {
    id: runtimeName,
    name: runtimeName,
    origin: 'internal',
    approval: 'auto'
  }
}

// An injected runtime tool that matches an auto-allow prefix but must still prompt — used for
// mutating cherry-tools (e.g. kb_manage) so a destructive call goes through per-call user approval.
function injectedRuntimeToolRequiringApproval(runtimeName: string): Tool {
  return {
    id: runtimeName,
    name: runtimeName,
    origin: 'internal',
    approval: 'prompt'
  }
}

export interface ClaudeAgentToolPolicySnapshot {
  resolve(runtimeName: string, input?: unknown): Tool | undefined
  isDisabled(runtimeName: string): boolean
  getPermissionMode(): AgentPermissionMode | undefined
  setPermissionMode(permissionMode: AgentPermissionMode | undefined): void
  update(
    agent: Pick<AgentEntity, 'mcps' | 'disabledTools' | 'configuration'>,
    options?: {
      serverNameById?: ReadonlyMap<string, string>
      /**
       * Denial names the ACTIVE connection still serves: a rename migrates the saved rules
       * while the replacement connection is deferred, so the live gate must keep blocking the
       * old identities until that replacement lands. Successive deferred-rebuild updates
       * ACCUMULATE — the driver can only pass its latest baseline, so replacing the retained
       * set would drop a name preserved by an earlier reconciliation while the old connection
       * still exposes it. An update with neither this option nor `keepRetainedDenied` is the
       * replacement connection's refresh and releases the retained names.
       */
      preserveDenied?: readonly string[]
      /**
       * A live-catalog refresh runs on the SAME active connection (its replacement is still
       * deferred), so it must neither merge new names nor release the retained ones — the
       * old identities stay blocking until the actual replacement lands.
       */
      keepRetainedDenied?: boolean
      /**
       * Mounted-server id → the record key the ACTIVE connection was built under. A denial
       * resolved against the CURRENT keys is re-emitted in this baseline key form and merged
       * into the retained set, so a disable that lands after a rename also blocks the
       * pre-rename identity (its preservation baseline is empty). Same-connection semantics:
       * pair it with `preserveDenied` — the replacement connection's refresh omits it and
       * releases the translated names like any other retained identity.
       */
      baselineServerNameById?: ReadonlyMap<string, string>
    }
  ): Promise<void>
}

export async function createClaudeAgentToolPolicySnapshot(
  agent: AgentEntity,
  options: {
    autoAllowRuntimeNames?: readonly string[]
    autoAllowRuntimeNamePrefixes?: readonly string[]
    // Runtime names that match an auto-allow list/prefix but must still require per-call approval
    // (e.g. mutating cherry-tools like kb_manage). Checked against the full runtime name.
    autoAllowRuntimeNameExceptions?: readonly string[]
    conditionContext?: ClaudeToolContext
    /** Mounted-server id → runtime record key, so id-keyed denials survive the #21322 rename. */
    serverNameById?: ReadonlyMap<string, string>
  } = {}
): Promise<ClaudeAgentToolPolicySnapshot> {
  let descriptors: ClaudeToolDescriptor[] = []
  let policy: ClaudeToolPolicy = {}
  let disallowed = new Set<string>()
  // Denial identities the active connection still serves across a deferred rebuild. Kept in
  // snapshot state and accumulated on every preserved update: the driver only ever passes its
  // LATEST baseline, so a rename followed by another policy change would otherwise drop the
  // first reconciliation's preservation while the old connection still serves that tool.
  let retainedDenied = new Set<string>()
  let rebuildSequence = 0
  // Updates serialize: an overlapping same-connection refresh must not advance past a rename
  // reconcile's rebuild and discard its preservation merge — the refresh's newer sequence made
  // the reconcile return early, dropping the retained denial while the old connection still
  // exposed it. The chain keeps every rebuild's retention semantics (preserve/keep/release) in
  // submission order; the sequence guard below stays as defense.
  let rebuildChain: Promise<void> = Promise.resolve()
  // The id → server-key mapping is mutable state: a server renamed mid-session must be
  // translated under its CURRENT key, or a later-added id-keyed denial blocks the
  // pre-rename name while the executable tool answers to the new one.
  let serverNameById = options.serverNameById

  const rebuild = async (
    nextAgent: Pick<AgentEntity, 'mcps' | 'disabledTools' | 'configuration'>,
    preserveDenied?: readonly string[],
    keepRetainedDenied?: boolean,
    baselineServerNameById?: ReadonlyMap<string, string>
  ) => {
    // `update()` is fire-and-forget and unserialized, so two rebuilds can overlap. Guard with a
    // sequence so an older slow rebuild that resolves AFTER a newer one can't clobber the newer
    // policy's `disallowed`/`descriptors` (which would re-enable a just-disabled tool).
    const sequence = ++rebuildSequence
    const catalog = await listClaudeAgentToolDescriptors(nextAgent)
    if (sequence !== rebuildSequence) return
    const nextDescriptors = [...catalog.descriptors]
    // A transient MCP fetch failure must not silently drop that server's tools from the catalog —
    // carry forward the previously-known descriptors for any failed MCP so a hiccup can't widen the
    // tool surface or break resolution mid-session.
    if (catalog.failedMcpIds.size > 0) {
      const existingIds = new Set(nextDescriptors.map((descriptor) => descriptor.id))
      for (const descriptor of descriptors) {
        if (descriptor.origin !== 'mcp' || !descriptor.sourceId) continue
        if (!catalog.failedMcpIds.has(descriptor.sourceId) || existingIds.has(descriptor.id)) continue
        nextDescriptors.push(descriptor)
        existingIds.add(descriptor.id)
      }
    }
    descriptors = nextDescriptors
    policy = buildClaudeToolPolicy(nextAgent)
    // Same derivation as the build-time SDK `disallowedTools`, recomputed on every live update so a
    // mid-session disable is honored by `canUseTool` on the warm connection (registry exposure +
    // user opt-out + dependency cascade). Legacy id-keyed rules are rewritten first so a denial
    // saved under the pre-#21322 namespace still blocks its name-keyed tool.
    // A preserved update merges into the retained set (see `retainedDenied`); a same-connection
    // catalog refresh keeps it untouched AND carries the previously-effective denials forward —
    // the refresh can land before the driver's reconciliation submits its preservation baseline,
    // and the active connection still serves every identity the previous set blocked until its
    // replacement rebuilds; an update with neither option is the replacement connection's
    // connect refresh, whose surface no longer includes the old identities — release them.
    if (preserveDenied) {
      retainedDenied = new Set([...retainedDenied, ...preserveDenied])
    } else if (keepRetainedDenied) {
      retainedDenied = new Set([...retainedDenied, ...disallowed])
    } else {
      retainedDenied = new Set()
    }
    const freshDenied = resolveDisallowedTools(
      { disabledTools: translateLegacyMcpToolRules(nextAgent.disabledTools, serverNameById) },
      options.conditionContext
    )
    // The active connection still answers to its connect-time keys: re-express each fresh
    // current-key denial under the baseline keys so a disable that lands after a rename also
    // blocks the pre-rename identity until the replacement connection releases it.
    if (baselineServerNameById) {
      for (const denial of freshDenied) {
        for (const [id, baselineKey] of baselineServerNameById) {
          const currentKey = serverNameById?.get(id)
          if (currentKey === undefined || currentKey === baselineKey) continue
          const currentPrefix = `mcp__${toSdkMcpServerSegment(currentKey)}__`
          if (!denial.startsWith(currentPrefix)) continue
          retainedDenied.add(`mcp__${toSdkMcpServerSegment(baselineKey)}__${denial.slice(currentPrefix.length)}`)
        }
      }
    }
    disallowed = new Set([...retainedDenied, ...freshDenied])
  }

  await rebuild(agent)

  return {
    resolve(runtimeName, input) {
      if (options.autoAllowRuntimeNameExceptions?.includes(runtimeName)) {
        return injectedRuntimeToolRequiringApproval(runtimeName)
      }
      if (
        options.autoAllowRuntimeNames?.includes(runtimeName) ||
        options.autoAllowRuntimeNamePrefixes?.some((prefix) => runtimeName.startsWith(prefix))
      ) {
        return injectedRuntimeTool(runtimeName)
      }
      const descriptor = findRuntimeDescriptor(descriptors, runtimeName)
      if (!descriptor) return undefined
      const access = resolveClaudeToolInvocationAccess(descriptor, policy, { toolName: runtimeName, input })
      return descriptorToToolWithAccess(descriptor, access)
    },

    isDisabled(runtimeName) {
      return disallowed.has(runtimeName) || disallowed.has(normalizeClaudeBuiltinName(runtimeName))
    },

    getPermissionMode() {
      return policy.permissionMode
    },

    setPermissionMode(permissionMode) {
      policy = { ...policy, permissionMode }
    },

    update(agent, nextOptions) {
      if (nextOptions?.serverNameById) serverNameById = nextOptions.serverNameById
      const run = rebuildChain.then(() =>
        rebuild(
          agent,
          nextOptions?.preserveDenied,
          nextOptions?.keepRetainedDenied,
          nextOptions?.baselineServerNameById
        )
      )
      rebuildChain = run.catch(() => undefined)
      return run
    }
  }
}
