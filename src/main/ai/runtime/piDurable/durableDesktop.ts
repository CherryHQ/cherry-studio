import type { AgentChange } from '@earendil-works/pi-durable'

import { application } from '@application'
import { ensureAgentDataDirectory } from '@main/ai/agents/agentDataDirectory'
import { resolveMountedMcpServers } from '@main/ai/agents/builtin/builtinAgentCapabilities'
import { listBuiltinToolPolicies } from '@main/ai/toolApproval/builtinToolPolicy'
import { resolveKnowledgeBaseScope } from '@main/ai/utils/knowledgeScope'
import { getPathFromEnvironment, getShellEnv } from '@main/utils/shellEnv'
import { normalizePiDisabledToolId } from '@shared/ai/piBuiltinTools'
import { buildFunctionCallToolName } from '@shared/ai/tools/mcpToolName'

import { buildAgentMcpServers, warmAgentMcpToolCatalogs } from '../agentMcpServers'
import { prepareAgentSessionWorkspaceDirectory } from '../agentSessionWorkspace'
import { capturePiConnectionSnapshot } from '../pi/piConnectionSignature'
import { buildPiMcpToolName } from '../pi/piMcpExtension'
import { loadPiSdk } from '../pi/piSdk'
import { buildPiLoginPathPrefix, mergePiShellExecutionEnv, resolvePiShellPath } from '../pi/piShell'
import type { AgentRuntimeConnectInput, AgentRuntimeEvent } from '../types'
import { createDurableMcp } from './durableMcp'
import { buildDurablePrompt } from './durablePrompt'
import { withDurableShellTimeout } from './durableShellTimeout'

export async function prepareDurableDesktop(
  input: AgentRuntimeConnectInput,
  emit: (event: AgentRuntimeEvent) => void,
  namespace?: string
) {
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
  const prompt = await buildDurablePrompt(pi, {
    agent,
    cwd,
    agentDataPath,
    effectiveLanguage: snapshot.effectiveLanguage,
    disabledTools: disabled,
    knowledgeBaseScope: resolveKnowledgeBaseScope(agent.knowledgeBaseIds, input.knowledgeBaseIds),
    skillPaths: snapshot.additionalSkillPaths,
    mcpInstructions: snapshot.mcpInstructions
  })
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
    const registry = native.createRegistry()
    const coding = tools.createCodingTools({ images: await images.createNodePhotonImages() })
    const bash = tools.createBashTool({
      commandPrefix: buildPiLoginPathPrefix(getPathFromEnvironment(env))
    })
    registry.install(
      native.defineExtension({
        ...coding,
        tools: [
          ...(coding.tools ?? []).filter((tool) => tool.name !== 'bash'),
          withDurableShellTimeout(bash),
          ...(process.platform === 'win32' ? [withDurableShellTimeout(tools.createPowerShellTool())] : [])
        ]
      })
    )
    registry.install(createCodemodeExtension({ sandbox: new CodemodeSandbox(), models: false }))
    registry.install(createToolSearchExtension())
    registry.install(mcp.extension)
    registry.install(native.defineExtension({ name: 'cherry.desktop', sections: prompt.sections }))
    if (namespace) {
      for (const extension of registry.snapshot().installed()) {
        registry.uninstall(extension)
        registry.install(native.defineExtension({ ...extension, name: `${namespace}/${extension.name}` }))
      }
    }
    const environment = new NodeExecutionEnv({
      cwd,
      shellPath: resolvePiShellPath(),
      // Per-call PATH overrides the SDK's inherited environment. Merge the complete PATH here.
      shellEnv: mergePiShellExecutionEnv(env)
    })
    const agentConfig: AgentChange = {
      ...(namespace && { extensions: registry.snapshot().installed() }),
      tools: {
        remove: registry
          .snapshot()
          .installed()
          .flatMap((extension) => extension.tools ?? [])
          .filter((tool) => isDisabled(tool.name))
      },
      cwd,
      instructions: prompt.instructions
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
        // The approval gate reads the mode per tool call, so a change applies mid-turn from the next call.
        const permissionChanged = mode !== permissionMode
        permissionMode = mode
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
