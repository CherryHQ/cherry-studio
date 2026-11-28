import type { AcpCliOptions } from '@cherrystudio/agent-runtime-acp/profile'
import { ampCli } from '@cherrystudio/agent-runtime-amp-acp/cli'
import { antigravityCli } from '@cherrystudio/agent-runtime-antigravity-acp/cli'
import { claudeCli } from '@cherrystudio/agent-runtime-claude-code/cli'
import { clineCli } from '@cherrystudio/agent-runtime-cline-acp/cli'
import { codeBuddyCli } from '@cherrystudio/agent-runtime-codebuddy-acp/cli'
import { codexCli } from '@cherrystudio/agent-runtime-codex/cli'
import { copilotCli } from '@cherrystudio/agent-runtime-copilot-acp/cli'
import { cursorPreset } from '@cherrystudio/agent-runtime-cursor/cli'
import { deepAgentsCli } from '@cherrystudio/agent-runtime-deepagents-acp/cli'
import { dshCli } from '@cherrystudio/agent-runtime-deepseek-harness-acp/cli'
import { dimcodeCli } from '@cherrystudio/agent-runtime-dimcode-acp/cli'
import { factoryCli } from '@cherrystudio/agent-runtime-factory-acp/cli'
import { glmCli } from '@cherrystudio/agent-runtime-glm-acp/cli'
import { gooseCli } from '@cherrystudio/agent-runtime-goose-acp/cli'
import { grokCli } from '@cherrystudio/agent-runtime-grok-acp/cli'
import { hermesCli } from '@cherrystudio/agent-runtime-hermes-acp/cli'
import { junieCli } from '@cherrystudio/agent-runtime-junie-acp/cli'
import { kimiCli } from '@cherrystudio/agent-runtime-kimi-acp/cli'
import { kiroCli } from '@cherrystudio/agent-runtime-kiro-acp/cli'
import { minimaxCli } from '@cherrystudio/agent-runtime-minimax-acp/cli'
import { museCodeCli } from '@cherrystudio/agent-runtime-muse-code-acp/cli'
import { ompCli } from '@cherrystudio/agent-runtime-omp-acp/cli'
import { openClawCli } from '@cherrystudio/agent-runtime-openclaw-acp/cli'
import { openCodeCli } from '@cherrystudio/agent-runtime-opencode-acp/cli'
import { piCli } from '@cherrystudio/agent-runtime-pi-acp/cli'
import { poolsideCli } from '@cherrystudio/agent-runtime-poolside-acp/cli'
import { qoderCli, qoderGlobalCli } from '@cherrystudio/agent-runtime-qoder-acp/cli'
import { qwenCli } from '@cherrystudio/agent-runtime-qwen-acp/cli'
import { snowCli } from '@cherrystudio/agent-runtime-snow-acp/cli'
import { traeCli } from '@cherrystudio/agent-runtime-trae-acp/cli'
import { vibeCli } from '@cherrystudio/agent-runtime-vibe-acp/cli'
import { zcodeCli } from '@cherrystudio/agent-runtime-zcode-acp/cli'
import {
  type CliAccountProbe,
  type CliPreset,
  type CliPresetOptions,
  parseBooleanLoginStatus,
  type RuntimePreset
} from '@cherrystudio/agent-runtime/cli'

export type LocalAgentProtocol = 'acp' | 'claude' | 'codex' | 'cursor'

type LocalAgentCliOptions = CliPresetOptions & AcpCliOptions

export type LocalCliAgentPreset = CliPreset<Exclude<LocalAgentProtocol, 'cursor'>> & AcpCliOptions

type CursorPreset = RuntimePreset<'cursor'> & { id: 'cursor' } & {
  [K in keyof LocalAgentCliOptions]?: never
}

export type LocalAgentPreset = LocalCliAgentPreset | CursorPreset

export const LOCAL_AGENT_PRESETS: readonly LocalAgentPreset[] = [
  claudeCli,
  codexCli,
  copilotCli,
  minimaxCli,
  cursorPreset,
  kimiCli,
  qwenCli,
  openCodeCli,
  openClawCli,
  dshCli,
  kiroCli,
  qoderGlobalCli,
  qoderCli,
  traeCli,
  hermesCli,
  clineCli,
  {
    id: 'kilo',
    permissionMode: {
      values: { code: 'default', plan: 'plan' },
      workflowValues: { ask: 'read-only', debug: 'work', orchestrator: 'work' }
    },
    terminalArgs: [],
    name: 'Kilo',
    protocol: 'acp',
    executable: 'kilo',
    args: ['acp'],
    helpUrl: 'https://kilo.ai/'
  },
  gooseCli,
  codeBuddyCli,
  {
    id: 'auggie',
    terminalArgs: [],
    loginArgs: ['auth', 'login'],
    npmPackage: '@augmentcode/auggie',
    minimumAcpVersion: '1.0.0',
    name: 'Auggie CLI',
    protocol: 'acp',
    executable: 'auggie',
    args: ['--acp'],
    env: {
      AUGMENT_DISABLE_AUTO_UPDATE: '1'
    },
    helpUrl: 'https://www.augmentcode.com/'
  },
  junieCli,
  factoryCli,
  {
    id: 'devin',
    permissionMode: {
      values: { 'accept-edits': 'default', smart: 'auto', plan: 'plan', bypass: 'bypassPermissions' },
      workflowValues: { ask: 'read-only' },
      nativePermissionNames: true
    },
    terminalArgs: [],
    loginArgs: ['auth', 'login'],
    accountProbe: {
      args: ['auth', 'status'],
      signedOutExitCode: 1,
      parse(output) {
        if (/^Not logged in\b/im.test(output)) return { status: 'signed-out' }
        if (!/^Logged in\b/im.test(output)) return { status: 'unknown' }
        const email = /^\s*Email:[ \t]*(\S+)/im.exec(output)?.[1]
        const displayName = /^\s*Name:[ \t]*([^\r\n]+)/im.exec(output)?.[1]?.trim()
        return { status: 'signed-in', ...(email || displayName ? { account: { email, displayName } } : {}) }
      }
    } satisfies CliAccountProbe,
    name: 'Devin',
    protocol: 'acp',
    executable: 'devin',
    args: ['acp'],
    helpUrl: 'https://docs.devin.ai/cli'
  },
  antigravityCli,
  vibeCli,
  ampCli,
  piCli,
  ompCli,
  snowCli,
  zcodeCli,
  deepAgentsCli,
  { ...glmCli, retired: true },
  grokCli,
  {
    id: 'command-code',
    name: 'Command Code',
    protocol: 'acp',
    account: { methods: [] },
    accountProbe: {
      args: ['status', '--json'],
      signedOutExitCode: 1,
      parse: (output) => parseBooleanLoginStatus(output, 'authenticated')
    },
    executable: 'command-code',
    npmPackage: 'command-code',
    args: ['acp'],
    terminalArgs: [],
    loginArgs: ['login'],
    credentialEnvironment: ['COMMAND_CODE_API_KEY'],
    helpUrl: 'https://commandcode.ai/docs/acp'
  },
  dimcodeCli,
  museCodeCli,
  {
    id: 'cortex-code',
    permissionMode: { values: { standard: 'default', plan: 'plan', bypass: 'bypassPermissions' } },
    name: 'Cortex Code',
    protocol: 'acp',
    executable: 'cortex',
    args: ['acp', 'serve'],
    helpUrl: 'https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code'
  },
  { ...poolsideCli, retired: true }
]

export function getLocalAgentPreset(presetId: string | undefined): LocalAgentPreset | undefined {
  return LOCAL_AGENT_PRESETS.find((preset) => preset.id === presetId)
}
