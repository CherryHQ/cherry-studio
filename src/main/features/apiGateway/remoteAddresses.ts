import type { NetworkInterfaceInfo } from 'node:os'

import { networkInterfaces, type Systeminformation } from 'systeminformation'

type InterfaceMetadata = Pick<
  Systeminformation.NetworkInterfacesData,
  'iface' | 'ifaceName' | 'type' | 'virtual' | 'default'
>

export async function getInterfaceMetadata(): Promise<InterfaceMetadata[]> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      networkInterfaces().catch(() => []),
      new Promise<InterfaceMetadata[]>((resolve) => {
        timer = setTimeout(() => resolve([]), 1000)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

function interfaceKind(name: string, metadata?: InterfaceMetadata): 'physical' | 'tunnel' | 'virtual' | 'unknown' {
  const label = `${name} ${metadata?.ifaceName ?? ''}`
  if (
    /^(?:utun\d+|tun\d+|tap\d+|wg\d+|tailscale\d+|zt[a-z0-9]+)$/i.test(name) ||
    /\b(?:tunnel|wintun|wireguard|tap-windows)\b/i.test(label)
  )
    return 'tunnel'
  if (
    metadata?.virtual ||
    /^(?:veth|docker|virbr|vboxnet|vmnet|vmenet|br-)/i.test(name) ||
    /\b(?:vethernet|vmware|virtualbox)\b/i.test(label)
  )
    return 'virtual'
  // These interfaces can report "wired" without representing a physical adapter.
  if (/^(?:bridge|br\d|awdl|llw|ap\d)/i.test(name)) return 'unknown'
  if (metadata?.type === 'wired' || metadata?.type === 'wireless') return 'physical'
  return 'unknown'
}

export function getRemoteAddressOptions(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
  metadata: InterfaceMetadata[],
  ipv6: boolean
) {
  const candidates = Object.entries(interfaces).flatMap(([interfaceName, infos]) => {
    const info = metadata.find((item) => item.iface === interfaceName || item.ifaceName === interfaceName)
    const kind = interfaceKind(interfaceName, info)
    return (infos ?? [])
      .filter(
        (address) =>
          !address.internal &&
          (address.family === 'IPv4' ||
            (ipv6 &&
              address.family === 'IPv6' &&
              !/^fe[89ab][0-9a-f]:/i.test(address.address) &&
              !address.address.includes('%')))
      )
      .map(({ address, family }) => ({
        address,
        interfaceName,
        rank: {
          physical: { IPv4: 0, IPv6: 2 },
          tunnel: { IPv4: 1, IPv6: 3 },
          unknown: { IPv4: 4, IPv6: 5 },
          virtual: { IPv4: 6, IPv6: 7 }
        }[kind][family],
        default: info?.default ?? false
      }))
  })
  candidates.sort(
    (a, b) =>
      a.rank - b.rank ||
      Number(b.default) - Number(a.default) ||
      a.interfaceName.localeCompare(b.interfaceName, 'en') ||
      a.address.localeCompare(b.address, 'en')
  )
  const seen = new Set<string>()
  return candidates
    .filter(({ address }) => {
      if (seen.has(address)) return false
      seen.add(address)
      return true
    })
    .map(({ address, interfaceName }) => ({ address, interfaceName }))
}
