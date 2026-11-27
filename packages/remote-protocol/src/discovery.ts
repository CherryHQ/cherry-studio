import * as z from 'zod'

export const remoteDiscoveryType = 'cherry-remote'
export const remoteConnectPath = '/v1/remote/connect'

const hostnameSchema = z
  .string()
  .max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i)
const hostSchema = z
  .union([z.ipv4(), z.ipv6().regex(/^[0-9a-f:.]+$/i), hostnameSchema])
  .transform((host) => (host.includes(':') ? new URL(`http://[${host}]`).hostname.slice(1, -1) : host.toLowerCase()))

export const directEndpointSchema = z.strictObject({
  host: hostSchema,
  port: z.number().int().min(1).max(65535),
  security: z.enum(['ws', 'wss'])
})
export type DirectEndpoint = z.infer<typeof directEndpointSchema>
export const configuredEndpointsSchema = z.array(directEndpointSchema).max(8)
export const remoteDiscoveryTxtSchema = z.object({
  v: z.literal('1'),
  identity: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9]+$/)
})

export function directEndpointUrl(endpoint: DirectEndpoint): string {
  const { host, port, security } = directEndpointSchema.parse(endpoint)
  return `${security}://${host.includes(':') ? `[${host}]` : host}:${port}${remoteConnectPath}`
}

/** Only direct WebSocket ingress is configurable; credentials and other RPC paths are not. */
export function parseDirectEndpoint(value: string): DirectEndpoint {
  if (
    value.length > 512 ||
    !/^(?:wss?|https?):\/\/(?:\[[a-fA-F0-9:]+\]|[a-zA-Z0-9.-]+)(?::[0-9]{1,5})?(?:\/(?:v1\/remote\/connect)?)?$/.test(
      value
    )
  )
    throw new Error('Invalid desktop address')
  const url = new URL(value)
  if (
    !['ws:', 'wss:', 'http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['', '/', remoteConnectPath].includes(url.pathname)
  )
    throw new Error('Invalid desktop address')
  return directEndpointSchema.parse({
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port: url.port ? Number(url.port) : ['wss:', 'https:'].includes(url.protocol) ? 443 : 80,
    security: ['wss:', 'https:'].includes(url.protocol) ? 'wss' : 'ws'
  })
}

/** A destination shared with another device must not resolve to its own loopback interface. */
export const advertisedEndpointSchema = directEndpointSchema.refine(({ host }) => {
  if (host === 'localhost' || host.endsWith('.localhost')) return false
  if (host === '::' || host === '::1' || host === '0.0.0.0' || host.startsWith('127.')) return false
  if (host.startsWith('::ffff:')) {
    const first = Number.parseInt(host.split(':').at(-2) ?? '', 16)
    if (first === 0 || first >> 8 === 127) return false
  }
  // Reject abbreviated and numeric IPv4 spellings parsed differently by URL implementations.
  try {
    return host.includes(':') || new URL(`http://${host}`).hostname === host
  } catch {
    return false
  }
}, 'Invalid remote destination')
