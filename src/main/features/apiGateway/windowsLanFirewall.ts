import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { loggerService } from '@logger'
import { API_GATEWAY_LAN_FIREWALL_RULE_NAME, API_GATEWAY_LAN_PORT } from '@shared/utils/apiGateway'

const execFileAsync = promisify(execFile)
const logger = loggerService.withContext('WindowsLanFirewall')

export type WindowsLanFirewallEnsureResult = 'skipped' | 'already' | 'ensured' | 'failed'

type NetshRunner = (args: string[]) => Promise<void>

/** `netsh` argv to probe whether the LAN pairing inbound rule already exists. */
export function buildWindowsLanFirewallShowArgs(ruleName: string = API_GATEWAY_LAN_FIREWALL_RULE_NAME): string[] {
  return ['advfirewall', 'firewall', 'show', 'rule', `name=${ruleName}`]
}

/** `netsh` argv to add an inbound TCP allow rule for the stable LAN pairing port. */
export function buildWindowsLanFirewallAddArgs(
  port: number = API_GATEWAY_LAN_PORT,
  ruleName: string = API_GATEWAY_LAN_FIREWALL_RULE_NAME
): string[] {
  return [
    'advfirewall',
    'firewall',
    'add',
    'rule',
    `name=${ruleName}`,
    'dir=in',
    'action=allow',
    'protocol=TCP',
    `localport=${String(port)}`,
    'profile=any'
  ]
}

function defaultNetshRunner(args: string[]): Promise<void> {
  return execFileAsync('netsh', args, { windowsHide: true, timeout: 15_000 }).then(() => undefined)
}

/**
 * Ensure a durable inbound allow rule for the LAN pairing port on Windows.
 * Non-Windows platforms are skipped. Missing elevation / policy blocks return `failed`
 * so callers can surface the problem instead of enabling LAN into a silent drop.
 */
export async function ensureWindowsLanFirewallRule(options?: {
  port?: number
  ruleName?: string
  platform?: NodeJS.Platform
  runNetsh?: NetshRunner
}): Promise<WindowsLanFirewallEnsureResult> {
  const platform = options?.platform ?? process.platform
  if (platform !== 'win32') return 'skipped'

  const port = options?.port ?? API_GATEWAY_LAN_PORT
  const ruleName = options?.ruleName ?? API_GATEWAY_LAN_FIREWALL_RULE_NAME
  const runNetsh = options?.runNetsh ?? defaultNetshRunner

  try {
    await runNetsh(buildWindowsLanFirewallShowArgs(ruleName))
    return 'already'
  } catch {
    // Rule missing (or query denied) — try to create it.
  }

  try {
    await runNetsh(buildWindowsLanFirewallAddArgs(port, ruleName))
    return 'ensured'
  } catch (error) {
    logger.warn('Failed to ensure Windows firewall allow rule for LAN pairing', {
      port,
      ruleName,
      error
    })
    return 'failed'
  }
}
