import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { SandboxSettings, Settings } from '@anthropic-ai/claude-agent-sdk'

import { application } from '@application'
import type { OperationResult } from '@cherrystudio/agent-runtime'
import type { ClaudeLoadedSettings } from '@cherrystudio/agent-runtime-claude-code'
import type { SandboxPolicy } from '@main/ai/toolApproval/sandboxPolicy'
import { isLinux, isWin } from '@main/core/platform'
import { t } from '@main/i18n'

const SANDBOX_PROBE_TIMEOUT_MS = 5_000

export type ClaudeCodeSandboxAvailability = { available: true } | { available: false; reason: string }

/**
 * Translates a resolved sandbox policy into the Claude Agent SDK `sandbox` option. The session's
 * cwd, `additionalDirectories` and temp directory are writable by the SDK's own defaults.
 */
export function toClaudeCodeSandboxSettings(policy: SandboxPolicy): SandboxSettings {
  return {
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: true,
    // Networked commands run only after an approved escape; `false` would make them fail outright.
    allowUnsandboxedCommands: true,
    network: {
      // Without it, Full Access silently allows unlisted hosts.
      strictAllowlist: true,
      allowedDomains: [...policy.allowedDomains],
      deniedDomains: [...policy.deniedDomains]
    },
    filesystem: { allowWrite: [...policy.writablePaths] }
  }
}

/**
 * Asks the Claude Code CLI whether its sandbox can run on this machine, through `claude sandbox status`
 * with a throwaway config directory, and on Linux also tries the nested user namespace the CLI needs.
 * Both probes run in the session's `cwd` so relative `PATH` entries resolve as they will for the CLI.
 * Never throws: any failure reports the sandbox unavailable. Native Windows is not enabled yet, so it
 * is never asked.
 */
export async function checkClaudeCodeSandboxAvailability(
  cliPath: string,
  env: Record<string, string | undefined>,
  cwd: string
): Promise<ClaudeCodeSandboxAvailability> {
  if (isWin) return { available: false, reason: 'the shell sandbox is not enabled on native Windows' }
  let availability: ClaudeCodeSandboxAvailability
  try {
    availability = await readSandboxStatus(cliPath, env, cwd)
  } catch (error) {
    return { available: false, reason: `claude sandbox status failed: ${(error as Error).message}` }
  }
  if (!availability.available || !isLinux) return availability
  return checkNestedUserNamespace(env, cwd)
}

async function readSandboxStatus(
  cliPath: string,
  env: Record<string, string | undefined>,
  cwd: string
): Promise<ClaudeCodeSandboxAvailability> {
  const configDir = await mkdtemp(application.getPath('feature.agents.claude.sandbox_status.temp', 'check-'))
  try {
    await writeFile(path.join(configDir, 'settings.json'), JSON.stringify({ sandbox: { enabled: true } }))
    return parseSandboxStatus(
      await runProbe(cliPath, ['sandbox', 'status'], { env: { ...env, CLAUDE_CONFIG_DIR: configDir }, cwd })
    )
  } finally {
    await rm(configDir, { recursive: true, force: true })
  }
}

// The CLI's seccomp helper nests a user namespace inside bubblewrap, which `status` does not try;
// Ubuntu's stock `bwrap-userns-restrict` AppArmor profile forbids it (anthropics/claude-code#43454).
async function checkNestedUserNamespace(
  env: Record<string, string | undefined>,
  cwd: string
): Promise<ClaudeCodeSandboxAvailability> {
  try {
    await runProbe(
      'bwrap',
      ['--unshare-user', '--dev-bind', '/', '/', 'unshare', '--user', '--map-root-user', 'true'],
      {
        env,
        cwd
      }
    )
    return { available: true }
  } catch (error) {
    return {
      available: false,
      reason: `bubblewrap cannot nest the user namespace the CLI's seccomp helper needs (anthropics/claude-code#43454): ${(error as Error).message}`
    }
  }
}

function runProbe(
  file: string,
  args: string[],
  options: { env: Record<string, string | undefined>; cwd: string }
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Its own process group, so a timeout also kills whatever the probe started.
    const child = spawn(file, args, { ...options, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    const timer = setTimeout(() => {
      reject(new Error(`${file} did not finish within ${SANDBOX_PROBE_TIMEOUT_MS} ms`))
      try {
        process.kill(-child.pid!, 'SIGKILL')
      } catch {
        // Already gone.
      }
    }, SANDBOX_PROBE_TIMEOUT_MS)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else reject(new Error(`${file} exited with ${code ?? signal}: ${stderr.trim()}`))
    })
  })
}

function parseSandboxStatus(stdout: string): ClaudeCodeSandboxAvailability {
  let status: { statusVersion?: unknown; supported?: unknown; enabled?: unknown; unavailableReason?: unknown }
  try {
    status = JSON.parse(stdout)
  } catch {
    return { available: false, reason: 'claude sandbox status did not print JSON' }
  }
  if (status.statusVersion !== 3) {
    return { available: false, reason: `unknown sandbox status version ${String(status.statusVersion)}` }
  }
  if (status.unavailableReason !== null) return { available: false, reason: String(status.unavailableReason) }
  if (status.supported !== true) return { available: false, reason: 'the CLI does not support a sandbox here' }
  if (status.enabled !== true) return { available: false, reason: 'the CLI did not enable the sandbox' }
  return { available: true }
}

/**
 * Throws unless the settings the running CLI reports leave the sandbox as Cherry sets it through the
 * flag tier. An unreported read, or a tier that declares a policy helper (which can rewrite managed
 * settings after this check), counts as unverifiable.
 */
export function assertSandboxSettingsUnchanged(loaded: OperationResult<ClaudeLoadedSettings>): void {
  if (loaded.status !== 'confirmed') {
    throw new Error(t('agent.session.sandbox_settings_unreported', { reason: loaded.error.message }))
  }
  const changes = loaded.value.sources
    .filter(({ source }) => source !== 'flagSettings')
    .flatMap(({ source, settings }) => sandboxChanges(settings).map((key) => `${source}: ${key}`))
  if (changes.length > 0) {
    throw new Error(t('agent.session.sandbox_unverifiable', { changes: changes.join('; ') }))
  }
}

const VIOLATIONS_BLOCK = /<sandbox_violations>([\s\S]*?)<\/sandbox_violations>/g
const NETWORK_DENIAL = /deny network-outbound (\S+?)(?::\d+)? \(/g

/**
 * Guidance appended to a sandboxed Bash result that reports a network denial, steering the model
 * to the approved escape. Returns `undefined` when the output reports no network denial.
 */
export function sandboxEscapeGuidance(output: string): string | undefined {
  // The CLI appends its block after the command's own output, so an earlier block is the command's text.
  const violations = Array.from(output.matchAll(VIOLATIONS_BLOCK)).at(-1)?.[1] ?? ''
  const hosts = [...new Set(Array.from(violations.matchAll(NETWORK_DENIAL), (match) => match[1]))]
  if (hosts.length === 0) return undefined
  const target = hosts.length === 1 ? 'this host' : 'these hosts'
  return (
    `The sandbox blocked network access to ${hosts.join(', ')}. ` +
    `If the user's request needs ${target}, run the same command again with \`dangerouslyDisableSandbox: true\`; ` +
    'Cherry Studio asks the user to approve that call, so do not ask in chat first. ' +
    '`allowed_domains` cannot widen network access in this session, and other tools must not be used to work around the block. ' +
    `If the request does not need ${target}, tell the user instead.`
  )
}

function sandboxChanges(settings: Settings): string[] {
  return [
    ...(settings.sandbox === undefined ? [] : ['sandbox']),
    ...(settings.policyHelper === undefined ? [] : ['policyHelper']),
    ...('policyHelpers' in settings ? ['policyHelpers'] : []),
    // These feed the sandbox's network and write allowlists.
    ...(settings.permissions?.additionalDirectories?.length ? ['permissions.additionalDirectories'] : []),
    ...(settings.permissions?.allow ?? []).filter((rule) => /^(WebFetch\(domain:|Edit\()/.test(rule))
  ]
}
