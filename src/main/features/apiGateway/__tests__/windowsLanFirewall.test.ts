import { beforeEach, describe, expect, it, vi } from 'vitest'

import { API_GATEWAY_LAN_FIREWALL_RULE_NAME, API_GATEWAY_LAN_PORT } from '@shared/utils/apiGateway'

import {
  buildWindowsLanFirewallAddArgs,
  buildWindowsLanFirewallShowArgs,
  ensureWindowsLanFirewallRule
} from '../windowsLanFirewall'

describe('windowsLanFirewall command contract', () => {
  it('builds a show probe for the durable LAN pairing rule name', () => {
    // Catches renaming the rule in TS without updating the probe Windows already has.
    expect(buildWindowsLanFirewallShowArgs()).toEqual([
      'advfirewall',
      'firewall',
      'show',
      'rule',
      `name=${API_GATEWAY_LAN_FIREWALL_RULE_NAME}`
    ])
  })

  it('builds an inbound TCP allow for the stable LAN port (not an OS-assigned port)', () => {
    // Catches a regression to port 0 / omitting localport — the #20736 failure mode.
    expect(API_GATEWAY_LAN_PORT).toBeGreaterThan(0)
    expect(buildWindowsLanFirewallAddArgs()).toEqual([
      'advfirewall',
      'firewall',
      'add',
      'rule',
      `name=${API_GATEWAY_LAN_FIREWALL_RULE_NAME}`,
      'dir=in',
      'action=allow',
      'protocol=TCP',
      `localport=${String(API_GATEWAY_LAN_PORT)}`,
      'profile=any'
    ])
  })
})

describe('ensureWindowsLanFirewallRule', () => {
  const runNetsh = vi.fn<(args: string[]) => Promise<void>>()

  beforeEach(() => {
    runNetsh.mockReset()
  })

  it('skips on non-Windows platforms', async () => {
    await expect(ensureWindowsLanFirewallRule({ platform: 'darwin', runNetsh })).resolves.toBe('skipped')
    expect(runNetsh).not.toHaveBeenCalled()
  })

  it('returns already when the rule probe succeeds', async () => {
    runNetsh.mockResolvedValue(undefined)
    await expect(ensureWindowsLanFirewallRule({ platform: 'win32', runNetsh })).resolves.toBe('already')
    expect(runNetsh).toHaveBeenCalledTimes(1)
    expect(runNetsh).toHaveBeenCalledWith(buildWindowsLanFirewallShowArgs())
  })

  it('adds the rule when the probe fails and reports ensured', async () => {
    runNetsh.mockRejectedValueOnce(new Error('No rules match')).mockResolvedValueOnce(undefined)
    await expect(ensureWindowsLanFirewallRule({ platform: 'win32', runNetsh })).resolves.toBe('ensured')
    expect(runNetsh).toHaveBeenNthCalledWith(1, buildWindowsLanFirewallShowArgs())
    expect(runNetsh).toHaveBeenNthCalledWith(2, buildWindowsLanFirewallAddArgs())
  })

  it('returns failed when Windows rejects creating the allow rule', async () => {
    // Catches treating a blocked Public-profile install as success (silent pairing drop).
    runNetsh.mockRejectedValue(new Error('Access is denied'))
    await expect(ensureWindowsLanFirewallRule({ platform: 'win32', runNetsh })).resolves.toBe('failed')
  })
})
