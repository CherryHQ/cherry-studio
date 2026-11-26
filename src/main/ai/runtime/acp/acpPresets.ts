import { application } from '@application'
import type { RuntimeAccountResult, SubscriptionUsageResult } from '@cherrystudio/agent-runtime'
import type { AcpHostBinary, AcpLaunch, AcpModelSelection } from '@cherrystudio/agent-runtime-acp/profile'
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
  copilotGateway,
  copilotModelProfile,
  readCopilotAccount,
  readCopilotSubscriptionUsage
} from '@cherrystudio/agent-runtime-copilot-acp'
import { copilotCli } from '@cherrystudio/agent-runtime-copilot-acp/cli'
import { dshEnvironment, dshPreset, prepareDshChat } from '@cherrystudio/agent-runtime-deepseek-harness-acp'
import {
  factoryGateway,
  factoryModelProfile,
  readFactoryAccount,
  readFactorySubscriptionUsage
} from '@cherrystudio/agent-runtime-factory-acp'
import { factoryCli } from '@cherrystudio/agent-runtime-factory-acp/cli'
import { glmGateway, glmModelProfile, readGlmSubscriptionUsage } from '@cherrystudio/agent-runtime-glm-acp'
import { glmCli } from '@cherrystudio/agent-runtime-glm-acp/cli'
import { goosePreset } from '@cherrystudio/agent-runtime-goose-acp'
import {
  createGrokAcpAdapter,
  grokGateway,
  grokModelProfile,
  readGrokAccount,
  readGrokModelCatalog,
  readGrokSubscriptionUsage
} from '@cherrystudio/agent-runtime-grok-acp'
import { grokCli } from '@cherrystudio/agent-runtime-grok-acp/cli'
import { hermesPreset } from '@cherrystudio/agent-runtime-hermes-acp'
import { kimiGateway, kimiModelProfile, readKimiAccount } from '@cherrystudio/agent-runtime-kimi-acp'
import { kimiCli } from '@cherrystudio/agent-runtime-kimi-acp/cli'
import { minimaxPreset } from '@cherrystudio/agent-runtime-minimax-acp'
import { ompGateway, ompModelProfile } from '@cherrystudio/agent-runtime-omp-acp'
import { attachOpenClawGateway, openClawPreset, openClawEnvironment } from '@cherrystudio/agent-runtime-openclaw-acp'
import {
  kiloGatewayOverlay,
  kiloModelProfile,
  openCodeAcpAdapter,
  openCodeGatewayOverlay,
  openCodeModelProfile,
  readOpenCodeGoSubscriptionUsage
} from '@cherrystudio/agent-runtime-opencode-acp'
import { openCodeCli } from '@cherrystudio/agent-runtime-opencode-acp/cli'
import { piAcpAdapter, piGateway, piModelProfile, preparePiAcpLaunch } from '@cherrystudio/agent-runtime-pi-acp'
import { poolsidePreset } from '@cherrystudio/agent-runtime-poolside-acp'
import { readQoderSubscriptionUsage } from '@cherrystudio/agent-runtime-qoder-acp'
import { qoderCli, qoderGlobalCli } from '@cherrystudio/agent-runtime-qoder-acp/cli'
import { qwenPreset } from '@cherrystudio/agent-runtime-qwen-acp'
import { snowPreset } from '@cherrystudio/agent-runtime-snow-acp'
import { readVibeAccount, vibeGateway, vibeModelProfile } from '@cherrystudio/agent-runtime-vibe-acp'
import { zcodePreset } from '@cherrystudio/agent-runtime-zcode-acp'
import type { LaunchSpec, SpawnStdio } from '@cherrystudio/agent-runtime/stdio'
import type { CliModelBinding } from '@main/ai/runtime/cli/cliModelProfile'
import { requireLaunchRuntime, type PrepareCliCommand } from '@main/ai/runtime/cli/cliProgram'
import type { DispatchDecision } from '@main/ai/toolApproval/ToolApprovalRegistry'
import type { LocalAgentConfiguration, LocalAgentSelection } from '@shared/ai/localAgent'
import { NativeQuestionReplySchema } from '@shared/ai/nativeInteraction'
import type { CliConfigTarget } from '@shared/utils/cliConfig'

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
  sessionMcp?: 'unsupported'
  acquireGateway?(
    overrides: Record<string, string>,
    launch: AcpLaunch,
    signal: AbortSignal
  ): Promise<{ dispose(): Promise<void> } | undefined>
  prepareChat?(
    config: LocalAgentConfiguration,
    launch: AcpLaunch,
    sessionId: string
  ): Promise<{
    gateway?: { dispose(): Promise<void> }
    mode: LocalAgentSelection & { application: 'reconnect' }
  }>
} & CliModelBinding

const presets: ReadonlyMap<string, DesktopAcpPreset> = new Map<string, DesktopAcpPreset>([
  [
    grokCli.id,
    {
      gateway: grokGateway,
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
      gatewayOverlay: openCodeGatewayOverlay,
      protocol: openCodeAcpAdapter,
      subscriptionUsage: { transport: 'cli', executable: openCodeCli.executable, read: readOpenCodeGoSubscriptionUsage }
    }
  ],
  ['kilo', { profile: kiloModelProfile, gatewayOverlay: kiloGatewayOverlay }],
  [
    glmCli.id,
    {
      profile: glmModelProfile,
      gateway: glmGateway,
      subscriptionUsage: { transport: 'acp', read: readGlmSubscriptionUsage }
    }
  ],
  [
    kimiCli.id,
    {
      profile: kimiModelProfile,
      gateway: kimiGateway,
      account: { transport: 'acp', read: readKimiAccount },
      subscriptionUsage: { transport: 'acp', read: readNegotiatedAcpUsage }
    }
  ],
  ['omp', { profile: ompModelProfile, gateway: ompGateway }],
  [
    copilotCli.id,
    {
      gateway: copilotGateway,
      profile: copilotModelProfile,
      account: { transport: 'cli', read: readCopilotAccount },
      subscriptionUsage: { transport: 'cli', executable: copilotCli.executable, read: readCopilotSubscriptionUsage }
    }
  ],
  [
    factoryCli.id,
    {
      profile: factoryModelProfile,
      gateway: factoryGateway,
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
  [
    'mistral-vibe',
    { profile: vibeModelProfile, gateway: vibeGateway, account: { transport: 'acp', read: readVibeAccount } }
  ],
  [
    'pi-acp',
    {
      protocol: piAcpAdapter,
      profile: piModelProfile,
      gateway: piGateway,
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
      prepareChat: (config, launch, sessionId) =>
        prepareDshChat(
          config.env,
          launch,
          application.get('CacheService').getPersist('local_agent.session_overrides')[sessionId]?.mode,
          (defaultProfile) =>
            application.get('DeepSeekHarnessService').prepareAgent(defaultProfile ? sessionId : undefined)
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
  [minimaxPreset.id, minimaxPreset],
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
