import type { AgentChange } from '@earendil-works/pi-durable'

import { application } from '@application'
import { ensureAgentDataDirectory } from '@main/ai/agents/agentDataDirectory'
import { resolveAgentCapabilities, resolveMountedMcpServers } from '@main/ai/agents/builtin/builtinAgentCapabilities'
import { PromptBuilder } from '@main/ai/agents/prompt'
import { listBuiltinToolPolicies } from '@main/ai/toolApproval/builtinToolPolicy'
import { resolveKnowledgeBaseScope } from '@main/ai/utils/knowledgeScope'
import { getPathFromEnvironment, getShellEnv } from '@main/utils/shellEnv'
import {
  KB_READ_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME
} from '@shared/ai/builtinTools'
import { normalizePiDisabledToolId } from '@shared/ai/piBuiltinTools'
import { buildFunctionCallToolName } from '@shared/ai/tools/mcpToolName'

import { buildAgentMcpServers, warmAgentMcpToolCatalogs } from '../agentMcpServers'
import { buildAgentRuntimePrompt } from '../agentPrompt'
import { prepareAgentSessionWorkspaceDirectory } from '../agentSessionWorkspace'
import { buildCitationsGuidance } from '../citationsGuidance'
import { capturePiConnectionSnapshot } from '../pi/piConnectionSignature'
import { buildPiMcpToolName } from '../pi/piMcpExtension'
import { loadPiSdk } from '../pi/piSdk'
import { buildPiLoginPathPrefix, mergePiBashExecutionEnv, resolvePiShellPath } from '../pi/piShell'
import type { AgentRuntimeConnectInput, AgentRuntimeEvent } from '../types'
import { createDurableMcp } from './durableMcp'

export async function prepareDurableDesktop(input: AgentRuntimeConnectInput, emit: (event: AgentRuntimeEvent) => void) {
  const discovery = await capturePiConnectionSnapshot(
    input.sessionId,
    input.agentId,
    input.modelId,
    input.knowledgeBaseIds
  )
  await warmAgentMcpToolCatalogs(discovery.agent.mcps ?? [])
  const snapshot = await capturePiConnectionSnapshot(
    input.sessionId,
    input.agentId,
    input.modelId,
    input.knowledgeBaseIds
  )
  const { session, agent } = snapshot
  const cwd = session.workspace.path
  await prepareAgentSessionWorkspaceDirectory(session)
  let permissionMode = agent.configuration?.permission_mode ?? 'default'
  let disabled = new Set((agent.disabledTools ?? []).map(normalizePiDisabledToolId))
  const agentDataPath = await ensureAgentDataDirectory(application.getPath('feature.agents.data'), agent.id)
  const mountedServers = resolveMountedMcpServers(agent, {
    browserEnabled: application.get('PreferenceService').get('app.browser.agent_control.enabled'),
    computerUseEnabled: application.get('PreferenceService').get('app.computer_use.agent_control.enabled'),
    channelLinked: snapshot.linkedChannel !== null
  })
  const mountedPolicies = listBuiltinToolPolicies({ mountedServers })
  const policies = (approval: string, enforce = false) =>
    new Set(
      mountedPolicies
        .filter((policy) => policy.approval === approval && (!enforce || policy.bypassApproval === 'enforce'))
        .map((policy) => buildPiMcpToolName(policy.serverName, policy.toolName))
    )
  const scope = resolveKnowledgeBaseScope(agent.knowledgeBaseIds, input.knowledgeBaseIds)
  const enabled = (name: string) => !disabled.has(buildPiMcpToolName('cherry-tools', name))
  const prompt = await buildAgentRuntimePrompt({
    agent,
    workspacePath: cwd,
    agentDataPath,
    effectiveLanguage: snapshot.effectiveLanguage,
    mcpInstructions: snapshot.mcpInstructions,
    citationsGuidance: buildCitationsGuidance({
      web: enabled(WEB_SEARCH_TOOL_NAME) || enabled(WEB_FETCH_TOOL_NAME),
      kb:
        (resolveAgentCapabilities(agent).allKnowledgeBases || scope.length > 0) &&
        (enabled(KB_SEARCH_TOOL_NAME) || enabled(KB_READ_TOOL_NAME))
    })
  })
  const [
    native,
    tools,
    { NodeExecutionEnv },
    { createCodemodeExtension },
    { createToolSearchExtension },
    { CodemodeSandbox },
    images,
    pi,
    env
  ] = await Promise.all([
    import('@earendil-works/pi-durable'),
    import('@earendil-works/pi-durable/tools'),
    import('@earendil-works/pi-durable/env/node'),
    import('@earendil-works/pi-durable/codemode'),
    import('@earendil-works/pi-durable/tool-search'),
    import('@earendil-works/pi-codemode'),
    import('@earendil-works/pi-durable/images/node'),
    loadPiSdk(),
    getShellEnv()
  ])
  const mcp = await createDurableMcp(
    buildAgentMcpServers(
      session,
      agent,
      mountedServers,
      snapshot.mcpServerSnapshots,
      snapshot.linkedChannel,
      agentDataPath,
      input.knowledgeBaseIds
    )
  )
  try {
    const isDisabled = (name: string) => {
      const tool = mcp.metadata.get(name)
      return (
        disabled.has(name) ||
        Boolean(
          tool &&
          (disabled.has(buildFunctionCallToolName(tool.serverName, tool.name)) ||
            disabled.has(`mcp__${tool.serverId}__${tool.name}`))
        )
      )
    }
    const skills = pi.loadSkills({
      cwd,
      agentDir: application.getPath('feature.agents.pi.root'),
      skillPaths: [...snapshot.additionalSkillPaths],
      includeDefaults: false
    })
    const registry = native.createRegistry()
    const coding = tools.createCodingTools({ images: await images.createNodePhotonImages() })
    const bash = tools.createBashTool({
      commandPrefix: buildPiLoginPathPrefix(getPathFromEnvironment(env)),
      prepare(execution) {
        execution.env = mergePiBashExecutionEnv(execution.env)
      }
    })
    registry.install(
      native.defineExtension({
        ...coding,
        tools: [...(coding.tools ?? []).filter((tool) => tool.name !== 'bash'), bash]
      })
    )
    registry.install(createCodemodeExtension({ sandbox: new CodemodeSandbox(), models: false }))
    registry.install(createToolSearchExtension())
    registry.install(mcp.extension)
    const builder = new PromptBuilder()
    registry.install(
      native.defineExtension({
        name: 'cherry.desktop',
        sections: [
          { key: 'agent_identity', render: () => builder.buildMemoriesSection(agentDataPath) },
          { key: 'skills', render: () => pi.formatSkillsForPrompt(skills.skills) }
        ]
      })
    )
    const environment = new NodeExecutionEnv({
      cwd,
      shellPath: resolvePiShellPath(),
      shellEnv: mergePiBashExecutionEnv(env)
    })
    const agentConfig: AgentChange = {
      tools: {
        remove: registry
          .snapshot()
          .installed()
          .flatMap((extension) => extension.tools ?? [])
          .filter((tool) => isDisabled(tool.name))
      },
      cwd,
      instructions: [prompt.base.kind === 'custom' ? prompt.base.content : undefined, prompt.append]
        .filter(Boolean)
        .join('\n\n')
    }
    return {
      snapshot,
      registry,
      agentConfig,
      mcp,
      environment,
      approval: {
        sessionId: input.sessionId,
        workspacePath: cwd,
        agentDataPath,
        emit,
        getInteractionState: () => application.get('AgentSessionRuntimeService').getInteractionState(input.sessionId),
        getPermissionMode: () => permissionMode,
        isDisabled,
        additionalReadOnlyRoots: [...snapshot.additionalSkillPaths, application.getPath('feature.agents.outputs')],
        autoApprovedTools: policies('auto'),
        approvalRequiredTools: policies('required'),
        nonBypassableApprovalTools: policies('required', true),
        delegationTools: policies('delegation')
      },
      async reconcile(next: AgentRuntimeConnectInput, active: boolean) {
        const current = await capturePiConnectionSnapshot(
          next.sessionId,
          next.agentId,
          next.modelId,
          next.knowledgeBaseIds
        )
        const mode = current.agent.configuration?.permission_mode ?? 'default'
        const permissionChanged = !active && mode !== permissionMode
        if (!active) permissionMode = mode
        const names = (current.agent.disabledTools ?? []).map(normalizePiDisabledToolId)
        disabled = active ? new Set([...disabled, ...names]) : new Set(names)
        return { signature: current.signature, permissionChanged }
      },
      async close() {
        await mcp.close()
        await environment.cleanup((await import('@earendil-works/chord/context')).BACKGROUND_CONTEXT)
      }
    }
  } catch (error) {
    await mcp.close()
    throw error
  }
}
