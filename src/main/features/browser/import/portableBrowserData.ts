import * as z from 'zod'

export const ImportedCookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string().min(1),
  path: z.string().startsWith('/').default('/'),
  expires: z.number().finite().optional(),
  httpOnly: z.boolean().default(false),
  secure: z.boolean().default(false),
  sameSite: z.enum(['Strict', 'Lax', 'None']).optional()
})
export type ImportedCookie = z.infer<typeof ImportedCookieSchema>
export const ImportedOriginSchema = z.object({
  origin: z.string(),
  localStorage: z.array(z.object({ name: z.string(), value: z.string() })).max(10_000)
})
export const PortableBrowserDataSchema = z.object({
  cookies: z.array(z.unknown()).max(100_000).default([]),
  origins: z.array(z.unknown()).max(10_000).default([])
})

export function parsePortableBrowserData(text: string): z.infer<typeof PortableBrowserDataSchema> {
  if (text.trimStart().startsWith('{')) return PortableBrowserDataSchema.parse(JSON.parse(text))
  const cookies: unknown[] = []
  for (let line of text.split(/\r?\n/)) {
    const httpOnly = line.startsWith('#HttpOnly_')
    if (httpOnly) line = line.slice(10)
    if (!line || line.startsWith('#')) continue
    const fields = line.split('\t')
    if (fields.length !== 7) throw new Error('Invalid Netscape cookie file')
    const [domain, includeSubdomains, cookiePath, secure, expires, name, value] = fields
    if (!['TRUE', 'FALSE'].includes(includeSubdomains) || !['TRUE', 'FALSE'].includes(secure) || !/^\d+$/.test(expires))
      throw new Error('Invalid Netscape cookie flags')
    cookies.push({
      domain: includeSubdomains === 'TRUE' ? `.${domain.replace(/^\./, '')}` : domain.replace(/^\./, ''),
      path: cookiePath,
      secure: secure === 'TRUE',
      expires: Number(expires) || undefined,
      name,
      value,
      httpOnly
    })
  }
  return PortableBrowserDataSchema.parse({ cookies })
}

export function matchesImportDomain(hostname: string, domains: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/^\./, '')
  return (
    domains.length === 0 ||
    domains.some((domain) => {
      const candidate = domain.toLowerCase().replace(/^\./, '')
      return host === candidate || host.endsWith(`.${candidate}`)
    })
  )
}
