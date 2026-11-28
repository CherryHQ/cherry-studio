import { mkdtemp } from 'node:fs/promises'

import { parse as parseYaml } from 'yaml'

import { application } from '@application'
import type { RuntimeAccountResult, SubscriptionUsageResult } from '@cherrystudio/agent-runtime'
import type {
  AcpGatewayModel,
  AcpHostBinary,
  AcpLaunch,
  AcpModelSelection
} from '@cherrystudio/agent-runtime-acp/profile'
import {
  readNegotiatedAcpUsage,
  type AcpAccountReader,
  type AcpHarnessAdapter,
  type AcpModelCatalogReader,
  type AcpSubscriptionUsageReader
} from '@cherrystudio/agent-runtime-acp/v1'
import { ampSubscriptionUsage } from '@cherrystudio/agent-runtime-amp-acp'
import { ampCli } from '@cherrystudio/agent-runtime-amp-acp/cli'
import { antigravityPreset, readAntigravitySubscriptionUsage } from '@cherrystudio/agent-runtime-antigravity-acp'
import { antigravityCli } from '@cherrystudio/agent-runtime-antigravity-acp/cli'
import { clinePreset } from '@cherrystudio/agent-runtime-cline-acp'
import { codeBuddyPreset } from '@cherrystudio/agent-runtime-codebuddy-acp'
import {
  copilotModelProfile,
  readCopilotAccount,
  readCopilotSubscriptionUsage
} from '@cherrystudio/agent-runtime-copilot-acp'
import { copilotCli } from '@cherrystudio/agent-runtime-copilot-acp/cli'
import { deepAgentsPreset } from '@cherrystudio/agent-runtime-deepagents-acp'
import { dshEnvironment, dshPreset, prepareDshChat } from '@cherrystudio/agent-runtime-deepseek-harness-acp'
import {
  factoryModelProfile,
  readFactoryAccount,
  readFactorySubscriptionUsage
} from '@cherrystudio/agent-runtime-factory-acp'
import { factoryCli } from '@cherrystudio/agent-runtime-factory-acp/cli'
import { glmModelProfile, readGlmSubscriptionUsage } from '@cherrystudio/agent-runtime-glm-acp'
import { glmCli } from '@cherrystudio/agent-runtime-glm-acp/cli'
import { goosePreset } from '@cherrystudio/agent-runtime-goose-acp'
import {
  createGrokAcpAdapter,
  grokModelProfile,
  readGrokAccount,
  readGrokModelCatalog,
  readGrokSubscriptionUsage
} from '@cherrystudio/agent-runtime-grok-acp'
import { grokCli } from '@cherrystudio/agent-runtime-grok-acp/cli'
import { hermesPreset } from '@cherrystudio/agent-runtime-hermes-acp'
import { applyJunieGatewayModel } from '@cherrystudio/agent-runtime-junie-acp'
import { junieCli } from '@cherrystudio/agent-runtime-junie-acp/cli'
import { kimiModelProfile, readKimiAccount } from '@cherrystudio/agent-runtime-kimi-acp'
import { kimiCli } from '@cherrystudio/agent-runtime-kimi-acp/cli'
import { readKiroSubscriptionUsage } from '@cherrystudio/agent-runtime-kiro-acp'
import { kiroCli } from '@cherrystudio/agent-runtime-kiro-acp/cli'
import { minimaxPreset, readMiniMaxSubscriptionUsage } from '@cherrystudio/agent-runtime-minimax-acp'
import { minimaxCli } from '@cherrystudio/agent-runtime-minimax-acp/cli'
import { readMuseSubscriptionUsage } from '@cherrystudio/agent-runtime-muse-code-acp'
import { museCodeCli } from '@cherrystudio/agent-runtime-muse-code-acp/cli'
import { ompModelProfile } from '@cherrystudio/agent-runtime-omp-acp'
import { attachOpenClawGateway, openClawPreset, openClawEnvironment } from '@cherrystudio/agent-runtime-openclaw-acp'
import {
  kiloModelProfile,
  openCodeAcpAdapter,
  openCodeModelProfile,
  readOpenCodeGoSubscriptionUsage
} from '@cherrystudio/agent-runtime-opencode-acp'
import { openCodeCli } from '@cherrystudio/agent-runtime-opencode-acp/cli'
import { piAcpAdapter, piModelProfile, preparePiAcpLaunch } from '@cherrystudio/agent-runtime-pi-acp'
import { poolsidePreset } from '@cherrystudio/agent-runtime-poolside-acp'
import { readQoderSubscriptionUsage } from '@cherrystudio/agent-runtime-qoder-acp'
import { qoderCli, qoderGlobalCli } from '@cherrystudio/agent-runtime-qoder-acp/cli'
import { qwenPreset } from '@cherrystudio/agent-runtime-qwen-acp'
import { snowPreset } from '@cherrystudio/agent-runtime-snow-acp'
import { readVibeAccount, vibeModelProfile } from '@cherrystudio/agent-runtime-vibe-acp'
import { zcodePreset } from '@cherrystudio/agent-runtime-zcode-acp'
import type { AgentPermissionMode } from '@cherrystudio/agent-runtime/cli'
import type { LaunchSpec, SpawnStdio } from '@cherrystudio/agent-runtime/stdio'
import type { CliModelBinding } from '@main/ai/runtime/cli/cliModelProfile'
import { requireLaunchRuntime, type PrepareCliCommand } from '@main/ai/runtime/cli/cliProgram'
import type { DispatchDecision } from '@main/ai/toolApproval/ToolApprovalRegistry'
import {
  getLocalAgentLaunchMode,
  getLocalPermissionChoice,
  type LocalAgentConfiguration,
  type LocalAgentSelection
} from '@shared/ai/localAgent'
import { NativeQuestionReplySchema } from '@shared/ai/nativeInteraction'
import { CodeCli } from '@shared/types/codeCli'
import type { CliConfigTarget } from '@shared/utils/cliConfig'

import { readKiroQuotaIdentity } from './kiroQuotaIdentity'

type RequestDecision = <T>(
  target: { sessionId: string; toolCallId: string },
  tool: 'AskUserQuestion' | 'ExitPlanMode',
  input: Record<string, unknown>,
  signal: AbortSignal,
  settle: (decision: DispatchDecision) => { reply: T; output: unknown }
) => Promise<T>

type DesktopAcpPreset = {
  account?:
    | { transport: 'acp'; read: AcpAccountReader; args?: readonly string[] }
    | {
        transport: 'cli'
        read(launch: LaunchSpec, spawn: SpawnStdio, signal: AbortSignal): Promise<RuntimeAccountResult>
      }
  subscriptionUsage?:
    | { transport: 'acp'; read: AcpSubscriptionUsageReader }
    | (({ transport: 'cli'; executable: string } | { transport: 'terminal' }) & {
        read(
          launch: LaunchSpec & { readonly model?: string },
          spawn: SpawnStdio,
          signal: AbortSignal
        ): Promise<SubscriptionUsageResult>
      })
  readModelCatalog?: AcpModelCatalogReader
  protocol?: AcpHarnessAdapter | ((decide: RequestDecision) => AcpHarnessAdapter)
  selectModel?(configured: string | undefined, launch: AcpLaunch): AcpModelSelection
  catalogId?(model: string, available: readonly string[]): string
  defaultEnv?(): Record<string, string>
  automationName?(name: string, input: unknown): string | undefined
  hostBinary?: AcpHostBinary
  prepareCommand?: PrepareCliCommand
  prepareLoginCommand?: (command: AcpLaunch & { executable: string }) => AcpLaunch & { executable: string }
  applyGatewayModel?(launch: AcpLaunch, gateway: AcpGatewayModel): void | Promise<{ dispose(): Promise<void> }>
  sessionMcp?: 'unsupported'
  acquireGateway?(
    overrides: Record<string, string>,
    launch: AcpLaunch,
    signal: AbortSignal
  ): Promise<{ dispose(): Promise<void> } | undefined>
  prepareChat?(
    config: LocalAgentConfiguration,
    launch: AcpLaunch,
    sessionId: string,
    permissionMode?: AgentPermissionMode
  ): Promise<{
    gateway?: { dispose(): Promise<void> }
    mode: LocalAgentSelection & { application: 'reconnect' }
  }>
  chatConfigSignature?(config: LocalAgentConfiguration): string | undefined
} & CliModelBinding

const presets: ReadonlyMap<string, DesktopAcpPreset> = new Map<string, DesktopAcpPreset>([
  [deepAgentsPreset.id, deepAgentsPreset],
  [
    junieCli.id,
    {
      async applyGatewayModel(launch, gateway) {
        return applyJunieGatewayModel(launch, gateway, await mkdtemp(application.getPath('app.temp', 'junie-acp-')))
      }
    }
  ],
  [
    grokCli.id,
    {
      profile: grokModelProfile,
      account: { transport: 'acp', read: readGrokAccount },
      readModelCatalog: readGrokModelCatalog,
      subscriptionUsage: { transport: 'acp', read: readGrokSubscriptionUsage },
      protocol: (decide) =>
        createGrokAcpAdapter({
          ask: (target, input, signal, settle) =>
            decide(target, 'AskUserQuestion', input, signal, (decision) =>
              settle(decision.approved ? NativeQuestionReplySchema.safeParse(decision.updatedInput).data : undefined)
            ),
          reviewPlan: (target, input, signal) =>
            decide(target, 'ExitPlanMode', input, signal, (reply) => ({
              reply,
              output: { approved: reply.approved, reason: reply.reason }
            }))
        })
    }
  ],
  [
    openCodeCli.id,
    {
      profile: openCodeModelProfile,
      protocol: openCodeAcpAdapter,
      subscriptionUsage: { transport: 'cli', executable: openCodeCli.executable, read: readOpenCodeGoSubscriptionUsage }
    }
  ],
  ['kilo', { profile: kiloModelProfile }],
  [
    glmCli.id,
    {
      profile: glmModelProfile,
      subscriptionUsage: { transport: 'acp', read: readGlmSubscriptionUsage }
    }
  ],
  [
    kimiCli.id,
    {
      profile: kimiModelProfile,
      account: { transport: 'acp', read: readKimiAccount },
      subscriptionUsage: { transport: 'acp', read: readNegotiatedAcpUsage }
    }
  ],
  ['omp', { profile: ompModelProfile }],
  [
    copilotCli.id,
    {
      profile: copilotModelProfile,
      account: { transport: 'cli', read: readCopilotAccount },
      subscriptionUsage: { transport: 'cli', executable: copilotCli.executable, read: readCopilotSubscriptionUsage }
    }
  ],
  [
    factoryCli.id,
    {
      profile: factoryModelProfile,
      account: { transport: 'acp', read: readFactoryAccount, args: factoryCli.accountArgs },
      subscriptionUsage: { transport: 'cli', executable: factoryCli.executable, read: readFactorySubscriptionUsage }
    }
  ],
  [ampCli.id, { subscriptionUsage: ampSubscriptionUsage }],
  [
    qoderCli.id,
    {
      subscriptionUsage: {
        transport: 'cli',
        executable: qoderCli.executable,
        read: (launch, spawn, signal) => readQoderSubscriptionUsage('cn', launch, spawn, signal)
      }
    }
  ],
  ['mistral-vibe', { profile: vibeModelProfile, account: { transport: 'acp', read: readVibeAccount } }],
  [
    'pi-acp',
    {
      protocol: piAcpAdapter,
      profile: piModelProfile,
      prepareCommand: (command) =>
        preparePiAcpLaunch(command, {
          requireRuntime: requireLaunchRuntime,
          bridgeEntry: () => application.getPath('app.pi_acp.file')
        })
    }
  ],
  [
    openClawPreset.id,
    {
      ...openClawPreset,
      defaultEnv: () =>
        openClawEnvironment(
          application.getPath('external.openclaw.config'),
          application.getPath('external.openclaw.config', 'openclaw.json')
        ),
      acquireGateway: (env, launch, signal) =>
        attachOpenClawGateway(env, launch, () => application.get('OpenClawService').acquireGateway(signal))
    }
  ],
  [
    antigravityPreset.id,
    {
      protocol: antigravityPreset.protocol,
      subscriptionUsage: {
        transport: 'cli',
        executable: antigravityCli.executable,
        read: readAntigravitySubscriptionUsage
      }
    }
  ],
  [
    dshPreset.id,
    {
      ...dshPreset,
      defaultEnv: () => dshEnvironment(application.getPath('external.deepseek_harness.config')),
      prepareChat: (config, launch, sessionId, permissionMode) => {
        const catalog = getLocalAgentLaunchMode(config)
        const choice = permissionMode && getLocalPermissionChoice(catalog, permissionMode)
        return prepareDshChat(
          config.env,
          launch,
          catalog && choice ? { configId: catalog.id, value: choice.value } : undefined,
          (defaultProfile) =>
            application.get('DeepSeekHarnessService').prepareAgent(defaultProfile ? sessionId : undefined)
        )
      },
      chatConfigSignature: () =>
        JSON.stringify(
          application.getExisting?.('PreferenceService')?.get?.('feature.code_cli.configs')?.[
            CodeCli.DEEPSEEK_HARNESS
          ] ?? null
        )
    }
  ],
  [clinePreset.id, clinePreset],
  [goosePreset.id, goosePreset],
  [poolsidePreset.id, poolsidePreset],
  [codeBuddyPreset.id, codeBuddyPreset],
  [snowPreset.id, snowPreset],
  [
    qoderGlobalCli.id,
    {
      subscriptionUsage: {
        transport: 'cli',
        executable: qoderGlobalCli.executable,
        read: (launch, spawn, signal) => readQoderSubscriptionUsage('global', launch, spawn, signal)
      }
    }
  ],
  [qwenPreset.id, qwenPreset],
  [hermesPreset.id, hermesPreset],
  [
    kiroCli.id,
    {
      subscriptionUsage: {
        transport: 'cli',
        executable: kiroCli.executable,
        read: (launch, _spawn, signal) => readKiroSubscriptionUsage(() => readKiroQuotaIdentity(launch.env), signal)
      }
    }
  ],
  [
    museCodeCli.id,
    {
      subscriptionUsage: { transport: 'cli', executable: museCodeCli.executable, read: readMuseSubscriptionUsage }
    }
  ],
  [
    minimaxPreset.id,
    {
      ...minimaxPreset,
      subscriptionUsage: {
        transport: 'cli',
        executable: minimaxCli.executable,
        read: ({ model, env }, _spawn, signal) => {
          if (
            env.__MAVIS_RUNTIME_PROFILE ||
            env.__MAVIS_RUNTIME_DATA_DIR ||
            (!env.MINIMAX_DATA_DIR && !env.MAVIS_DATA_DIR && env.HOME !== application.getPath('sys.home')) ||
            env.MINIMAX_API_KEY ||
            env.MINIMAX_CN_API_KEY
          )
            return Promise.resolve({ status: 'unsupported' })
          return readMiniMaxSubscriptionUsage(
            model,
            env.MAVIS_REGION,
            async () => {
              const [file] = await application.get('CodeCliService').readConfigFiles(['minimax-config'], { ...env })
              return file?.content ? parseYaml(file.content) : undefined
            },
            signal
          )
        }
      }
    }
  ],
  [zcodePreset.id, zcodePreset]
])

export function acpPreset(id: string | undefined): DesktopAcpPreset | undefined {
  return id ? presets.get(id) : undefined
}

export function bindAcpHarness(id: string | undefined, decide: RequestDecision) {
  const protocol = acpPreset(id)?.protocol
  return typeof protocol === 'function' ? protocol(decide) : protocol
}

const profiles = new Map(
  [...presets.values()].flatMap(({ profile }) => (profile ? [[profile.target, profile] as const] : []))
)

export function acpModelProfile(target: CliConfigTarget) {
  return profiles.get(target)
}
