import { application } from '@application'
import type {
  AcpCliInstaller,
  AcpHostBinary,
  AcpLaunch,
  AcpModelSelection
} from '@cherrystudio/agent-runtime-acp/profile'
import type { AcpHarnessAdapter, AcpModelCatalogReader } from '@cherrystudio/agent-runtime-acp/v1'
import { antigravityEnvironment, antigravityPreset } from '@cherrystudio/agent-runtime-antigravity-acp'
import { clinePreset } from '@cherrystudio/agent-runtime-cline-acp'
import { codeBuddyPreset } from '@cherrystudio/agent-runtime-codebuddy-acp'
import { copilotGateway, copilotModelProfile } from '@cherrystudio/agent-runtime-copilot-acp'
import { dshEnvironment, dshPreset, prepareDshChat } from '@cherrystudio/agent-runtime-deepseek-harness-acp'
import { factoryGateway, factoryModelProfile } from '@cherrystudio/agent-runtime-factory-acp'
import { glmGateway, glmModelProfile } from '@cherrystudio/agent-runtime-glm-acp'
import { goosePreset } from '@cherrystudio/agent-runtime-goose-acp'
import {
  createGrokAcpAdapter,
  grokGateway,
  grokModelProfile,
  readGrokModelCatalog
} from '@cherrystudio/agent-runtime-grok-acp'
import { grokCli } from '@cherrystudio/agent-runtime-grok-acp/cli'
import { hermesPreset } from '@cherrystudio/agent-runtime-hermes-acp'
import { kimiGateway, kimiModelProfile } from '@cherrystudio/agent-runtime-kimi-acp'
import { kiroInstaller } from '@cherrystudio/agent-runtime-kiro-acp'
import { minimaxPreset } from '@cherrystudio/agent-runtime-minimax-acp'
import { ompGateway, ompModelProfile } from '@cherrystudio/agent-runtime-omp-acp'
import { attachOpenClawGateway, openClawPreset, openClawEnvironment } from '@cherrystudio/agent-runtime-openclaw-acp'
import {
  kiloGatewayOverlay,
  kiloModelProfile,
  openCodeAcpAdapter,
  openCodeGatewayOverlay,
  openCodeModelProfile
} from '@cherrystudio/agent-runtime-opencode-acp'
import { piAcpAdapter, piBundledBridge, piGateway, piModelProfile } from '@cherrystudio/agent-runtime-pi-acp'
import { poolsidePreset } from '@cherrystudio/agent-runtime-poolside-acp'
import { qwenPreset } from '@cherrystudio/agent-runtime-qwen-acp'
import { snowPreset } from '@cherrystudio/agent-runtime-snow-acp'
import { traeInstall, traeRemoval } from '@cherrystudio/agent-runtime-trae-acp'
import { vibeGateway, vibeInstall, vibeModelProfile } from '@cherrystudio/agent-runtime-vibe-acp'
import { zcodePreset } from '@cherrystudio/agent-runtime-zcode-acp'
import type { CliInstallPlan } from '@cherrystudio/agent-runtime/cli'
import type { CliModelBinding } from '@main/ai/runtime/cli/cliModelProfile'
import type { DispatchDecision } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { CHERRY_NODE_PROXY_RULES_ENV, getProxyEnvironment } from '@main/services/proxy/proxyEnv'
import { mergeEnvironment } from '@main/utils/env'
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
  readModelCatalog?: AcpModelCatalogReader
  protocol?: AcpHarnessAdapter | ((decide: RequestDecision) => AcpHarnessAdapter)
  selectModel?(configured: string | undefined, launch: AcpLaunch): AcpModelSelection
  catalogId?(model: string, available: readonly string[]): string
  cliFallback?: { executable: string; args: string[]; retry(error: unknown): boolean }
  adapterEnv?(env: Record<string, string>, overrides: Record<string, string>): Record<string, string>
  defaultEnv?(): Record<string, string>
  installation?: 'native-cli'
  installer?: AcpCliInstaller & { file?: () => string }
  automationName?(name: string, input: unknown): string | undefined
  hostBinary?: AcpHostBinary
  bundledBridge?: {
    runtime: { executable: string; minimumVersion: string; label: string; major: string }
    commandEnv: string
    entry(): string
  }
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
  install?(platform: string): CliInstallPlan | undefined
  removeInstallation?(
    path: string,
    env: Record<string, string>,
    run: (args: string[], timeout: number, includeStderr?: boolean) => Promise<string>
  ): Promise<(() => Promise<void>) | undefined>
  stopForUninstall?(): Promise<boolean>
} & CliModelBinding

const presets: ReadonlyMap<string, DesktopAcpPreset> = new Map<string, DesktopAcpPreset>([
  [
    grokCli.id,
    {
      gateway: grokGateway,
      profile: grokModelProfile,
      readModelCatalog: readGrokModelCatalog,
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
  ['opencode', { profile: openCodeModelProfile, gatewayOverlay: openCodeGatewayOverlay, protocol: openCodeAcpAdapter }],
  ['kilo', { profile: kiloModelProfile, gatewayOverlay: kiloGatewayOverlay }],
  ['glm-acp-agent', { profile: glmModelProfile, gateway: glmGateway }],
  ['kimi', { profile: kimiModelProfile, gateway: kimiGateway, installation: 'native-cli' }],
  ['omp', { profile: ompModelProfile, gateway: ompGateway }],
  ['copilot', { profile: copilotModelProfile, gateway: copilotGateway }],
  ['factory-droid', { profile: factoryModelProfile, gateway: factoryGateway }],
  ['mistral-vibe', { profile: vibeModelProfile, gateway: vibeGateway, install: vibeInstall }],
  [
    'kiro',
    {
      install: kiroInstaller.script,
      installer: { ...kiroInstaller, file: () => application.getPath('external.acp.bin', kiroInstaller.executable) }
    }
  ],
  [
    'pi-acp',
    {
      protocol: piAcpAdapter,
      profile: piModelProfile,
      gateway: piGateway,
      bundledBridge: { ...piBundledBridge, entry: () => application.getPath('app.pi_acp.file') }
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
        attachOpenClawGateway(env, launch, () => application.get('OpenClawService').acquireGateway(signal)),
      stopForUninstall: async () =>
        (await application.get('OpenClawService').stopGateway({ requirePortFree: true })).success
    }
  ],
  [
    antigravityPreset.id,
    {
      ...antigravityPreset,
      installer: { ...antigravityPreset.installer, file: () => application.getPath('external.antigravity.cli.file') },
      adapterEnv: (env, overrides) => {
        const proxy = getProxyEnvironment()
        return antigravityEnvironment(env, overrides, proxy, !!proxy[CHERRY_NODE_PROXY_RULES_ENV], mergeEnvironment)
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
        ),
      stopForUninstall: async () => {
        await application.get('DeepSeekHarnessService').stop()
        return true
      }
    }
  ],
  [
    'trae',
    {
      install: traeInstall,
      removeInstallation: (path, env, run) =>
        traeRemoval(
          path,
          env,
          {
            bin: application.getPath('external.acp.bin'),
            installation: application.getPath('external.trae.installation')
          },
          run
        )
    }
  ],
  [clinePreset.id, clinePreset],
  [goosePreset.id, goosePreset],
  [poolsidePreset.id, poolsidePreset],
  [
    codeBuddyPreset.id,
    {
      ...codeBuddyPreset,
      stopForUninstall: async () => {
        await application.get('CodeBuddyWebUiService').stop()
        return true
      }
    }
  ],
  [snowPreset.id, snowPreset],
  [qwenPreset.id, qwenPreset],
  [
    hermesPreset.id,
    {
      ...hermesPreset,
      stopForUninstall: async () => {
        await application.get('HermesDashboardService').stop()
        return true
      }
    }
  ],
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

const installers = new Map(
  [...presets.values()].flatMap(({ installer }) => (installer ? [[installer.executable, installer] as const] : []))
)

export function acpCliInstaller(executable: string) {
  return installers.get(executable)
}
