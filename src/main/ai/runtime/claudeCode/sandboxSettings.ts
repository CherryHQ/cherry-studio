import { type Options, resolveSettings, type SandboxSettings, type Settings } from '@anthropic-ai/claude-agent-sdk'

import type { SandboxPolicy } from '@main/ai/toolApproval/sandboxPolicy'

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
 * Throws unless every other settings tier the CLI loads for these options leaves the sandbox as
 * Cherry sets it. `resolveSettings()` does not run an administrator's `policyHelper`, so a tier
 * that declares one also counts as unverifiable.
 */
export async function assertSandboxSettingsUnchanged(options: Pick<Options, 'cwd' | 'settingSources'>): Promise<void> {
  const { sources } = await resolveSettings({ cwd: options.cwd, settingSources: options.settingSources })
  const changes = sources.flatMap(({ source, settings }) => sandboxChanges(settings).map((key) => `${source}: ${key}`))
  if (changes.length > 0) {
    throw new Error(
      `The shell sandbox for this Agent cannot be verified because other Claude Code settings change it (${changes.join('; ')}). Remove those settings or contact your administrator.`
    )
  }
}

const NETWORK_DENIAL = /deny network-outbound (\S+?)(?::\d+)? \(/g

/**
 * Guidance appended to a sandboxed Bash result that reports a network denial, steering the model
 * to the approved escape. Returns `undefined` when the output reports no network denial.
 */
export function sandboxEscapeGuidance(output: string): string | undefined {
  const hosts = [...new Set(Array.from(output.matchAll(NETWORK_DENIAL), (match) => match[1]))]
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
    // These allow rules feed the sandbox's network and write allowlists.
    ...(settings.permissions?.allow ?? []).filter((rule) => /^(WebFetch\(domain:|Edit\()/.test(rule))
  ]
}
