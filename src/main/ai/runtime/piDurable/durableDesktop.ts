import type { AgentChange } from '@earendil-works/pi-durable'

import { application } from '@application'
import { ensureAgentDataDirectory } from '@main/ai/agents/agentDataDirectory'
import { resolveMountedMcpServers } from '@main/ai/agents/builtin/builtinAgentCapabilities'
import { agentMemoryReference } from '@main/ai/memory/memoryPrompt'
import { listBuiltinToolPolicies } from '@main/ai/toolApproval/builtinToolPolicy'
import { resolveKnowledgeBaseScope } from '@main/ai/utils/knowledgeScope'
import { getPathFromEnvironment, getShellEnv } from '@main/utils/shellEnv'
import { normalizePiDisabledToolId } from '@shared/ai/piBuiltinTools'

import { buildAgentMcpServers, warmAgentMcpToolCatalogs } from '../agentMcpServers'
import { prepareAgentSessionWorkspaceDirectory } from '../agentSessionWorkspace'
import { capturePiConnectionSnapshot } from '../pi/piConnectionSignature'
import { buildPiMcpToolName, isPiToolDisabled } from '../pi/piMcpExtension'
import { loadPiSdk } from '../pi/piSdk'
import { buildPiLoginPathPrefix, mergePiShellExecutionEnv, resolvePiShellPath } from '../pi/piShell'
import type { AgentRuntimeConnectInput, AgentRuntimeEvent } from '../types'
import { createDurableEnvironment, runDurableFileMutation } from './durableEnvironment'
import { createDurableMcp } from './durableMcp'
import { buildDurablePrompt } from './durablePrompt'
import { withDurableShellTimeout } from './durableShellTimeout'

export async function prepareDurableDesktop(
  input: AgentRuntimeConnectInput,
  emit: (event: AgentRuntimeEvent) => void,
  namespace?: string,
  isRoot?: (id: number) => boolean
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
  let permissionMode = input.permissionModeOverride ?? agent.configuration?.permission_mode ?? 'default'
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
    { createCodemodeExtension },
    { createToolSearchExtension },
    { CodemodeSandbox },
    images,
    pi,
    env
  ] = await Promise.all([
    import('@earendil-works/pi-durable'),
    import('@earendil-works/pi-durable/tools'),
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
    modelName: snapshot.model.name ?? snapshot.model.id,
    channelLinked: snapshot.linkedChannel !== null,
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
      input.knowledgeBaseIds,
      undefined,
      input.modelId
    )
  )
  try {
    const isDisabled = (name: string) => isPiToolDisabled(disabled, name, mcp.metadata.get(name))
    const registry = native.createRegistry()
    const coding = tools.createCodingTools({ images: await images.createNodePhotonImages() })
    const edit = tools.createEditTool()
    const write = tools.createWriteTool()
    const bash = tools.createBashTool({
      commandPrefix: buildPiLoginPathPrefix(getPathFromEnvironment(env))
    })
    registry.install(
      native.defineExtension({
        ...coding,
        tools: [
          ...(coding.tools ?? []).filter((tool) => !['bash', 'edit', 'write'].includes(tool.name)),
          {
            ...edit,
            execute: (...args: Parameters<typeof edit.execute>) => runDurableFileMutation(() => edit.execute(...args))
          },
          {
            ...write,
            execute: (...args: Parameters<typeof write.execute>) => runDurableFileMutation(() => write.execute(...args))
          },
          withDurableShellTimeout(bash),
          ...(process.platform === 'win32' ? [withDurableShellTimeout(tools.createPowerShellTool())] : [])
        ]
      })
    )
    registry.install(createCodemodeExtension({ sandbox: new CodemodeSandbox(), models: false }))
    registry.install(createToolSearchExtension())
    registry.install(mcp.extension)
    registry.install(
      native.defineExtension({
        name: 'cherry.desktop',
        hooks: [
          native.hook(native.GenerationTask, {
            async beforeRequest(request, api, context) {
              if (!isRoot?.(api.conversationId)) return undefined
              const memory = await agentMemoryReference(
                input.sessionId,
                () => application.get('AgentSessionRuntimeService').getInteractionState(input.sessionId),
                context.abortSignal
              )
              const [first, ...rest] = request.messages
              if (first?.role === 'system')
                return { messages: [{ ...first, sections: { ...first.sections, cherry_memory: memory } }, ...rest] }
              return {
                messages: [
                  { role: 'system', content: '', sections: { cherry_memory: memory }, timestamp: Date.now() },
                  ...request.messages
                ]
              }
            }
          })
        ],
        sections: prompt.sections
      })
    )
    if (namespace) {
      for (const extension of registry.snapshot().installed()) {
        registry.uninstall(extension)
        registry.install(native.defineExtension({ ...extension, name: `${namespace}/${extension.name}` }))
      }
    }
    const environment = await createDurableEnvironment({
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
        builtinRole: agent.configuration?.builtin_role,
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
        const mode = next.permissionModeOverride ?? current.agent.configuration?.permission_mode ?? 'default'
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
