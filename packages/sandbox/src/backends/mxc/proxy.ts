import { lookup, type LookupAddress } from 'node:dns'
import { isIP } from 'node:net'

import ipaddr from 'ipaddr.js'
import { RequestError, Server } from 'proxy-chain'

export function normalizeHost(host: string): string {
  return host
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
}

/** Each lease owns its proxy; only explicitly granted host/port pairs are forwarded. */
export async function createProxy(targets: readonly { host: string; port: number }[], onFailure: () => void) {
  const allowed = new Set(targets.map(({ host, port }) => `${normalizeHost(host)}:${port}`))
  const server = new Server({
    host: '127.0.0.1',
    port: 0,
    prepareRequestFunction: ({ hostname, port }) => {
      const host = normalizeHost(hostname)
      if (!allowed.has(`${host}:${port}`)) throw new RequestError('Sandbox destination denied', 403)
      return {
        // Private destinations require an explicit IP grant, never a DNS alias.
        dnsLookup: new Proxy(lookup, {
          apply(target, receiver, [name, options, callback]) {
            return Reflect.apply(target, receiver, [
              name,
              options,
              (error: Error | null, address: string | LookupAddress[], family: number) => {
                if (error) return callback(error, address, family)
                const addresses = Array.isArray(address) ? address.map((entry) => entry.address) : [address]
                if (!isIP(host) && addresses.some((value) => ipaddr.process(value).range() !== 'unicast'))
                  return callback(new Error('Private DNS destination denied'), '', 4)
                callback(null, address, family)
              }
            ])
          }
        })
      }
    }
  })
  server.server.requestTimeout = 10000
  server.server.headersTimeout = 5000
  server.server.maxConnections = 64
  server.server.on('connection', (socket) => socket.setTimeout(10000))
  server.server.on('error', onFailure)
  let closing: Promise<void> | undefined
  server.server.on('close', () => {
    if (!closing) onFailure()
  })
  await server.listen()
  return { url: `http://127.0.0.1:${server.port}`, close: () => (closing ??= server.close(true)) }
}
