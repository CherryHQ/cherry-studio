import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'

import * as z from 'zod'

import { application } from '@application'
import { directEndpointSchema } from '@cherrystudio/remote-protocol'
import type { OutputFor } from '@shared/ipc/types'

const execute = promisify(execFile)
type VpnStatus = OutputFor<'api_gateway.remote.check_networks'>[number]

const tailscaleStatusSchema = z.object({
  BackendState: z.string(),
  Self: z
    .object({
      Online: z.boolean().optional(),
      DNSName: z.string().optional(),
      TailscaleIPs: z.array(z.string()).optional()
    })
    .nullish()
})
const zeroTierNetworksSchema = z
  .array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
      assignedAddresses: z.array(z.string())
    })
  )
  .max(64)

function validHosts(hosts: string[]): string[] {
  return [...new Set(hosts)].filter((host) => directEndpointSchema.safeParse({ host, port: 1, security: 'ws' }).success)
}

export function parseVpnStatus(product: VpnStatus['product'], output: string): VpnStatus {
  const data: unknown = JSON.parse(output)
  if (product === 'tailscale') {
    const status = tailscaleStatusSchema.parse(data)
    const ready = status.BackendState === 'Running' && status.Self?.Online === true
    return {
      product,
      state: ready ? 'ready' : status.BackendState === 'NeedsLogin' ? 'needs-login' : 'offline',
      networks: ready
        ? [
            {
              name: 'Tailscale',
              hosts: validHosts([
                ...(status.Self?.DNSName ? [status.Self.DNSName.replace(/\.$/, '')] : []),
                ...(status.Self?.TailscaleIPs ?? []).filter(
                  (host) => z.union([z.ipv4(), z.ipv6()]).safeParse(host).success
                )
              ])
            }
          ]
        : []
    }
  }
  const networks = zeroTierNetworksSchema.parse(data)
  return {
    product,
    state: networks.some((network) => network.status === 'OK')
      ? 'ready'
      : networks.some((network) => network.status === 'ACCESS_DENIED')
        ? 'needs-approval'
        : 'offline',
    networks: networks
      .filter((network) => network.status === 'OK')
      .map((network) => ({
        name: network.name || network.id,
        hosts: validHosts(
          network.assignedAddresses
            .map((address) => address.split('/')[0])
            .filter((host) => z.union([z.ipv4(), z.ipv6()]).safeParse(host).success)
        )
      }))
  }
}

export async function checkVpnNetworks(signal: AbortSignal): Promise<VpnStatus[]> {
  const snapshots = await application.get('BinaryManager').getToolSnapshots(['tailscale', 'zerotier-cli'])
  signal.throwIfAborted()
  return Promise.all(
    (['tailscale', 'zerotier'] as const).map(async (product): Promise<VpnStatus> => {
      const availability = snapshots[product === 'tailscale' ? 'tailscale' : 'zerotier-cli']?.availability
      const app = application.getPath(product === 'tailscale' ? 'external.tailscale.app' : 'external.zerotier.app')
      let executable = availability && availability.source !== 'none' ? availability.path : undefined
      if (!executable && product === 'tailscale' && process.platform !== 'linux') {
        const bundled = application.getPath(
          'external.tailscale.app',
          process.platform === 'darwin' ? 'Contents/MacOS/Tailscale' : 'tailscale.exe'
        )
        if (existsSync(bundled)) executable = bundled
      }
      if (!executable) return { product, state: existsSync(app) ? 'unknown' : 'not-detected', networks: [] }
      try {
        const { stdout } = await execute(
          executable,
          product === 'tailscale' ? ['status', '--json'] : ['-j', 'listnetworks'],
          {
            signal,
            timeout: 5000,
            maxBuffer: 1024 * 1024,
            windowsHide: true
          }
        )
        return parseVpnStatus(product, stdout)
      } catch {
        signal.throwIfAborted()
        return { product, state: 'unknown', networks: [] }
      }
    })
  )
}
