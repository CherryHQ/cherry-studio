import { net } from 'electron'
import { valid as semverValid } from 'semver'

const PACKAGE_NAME = '@anthropic-ai/claude-code-win32-arm64'

export function claudeNpmRegistries(registry = 'https://registry.npmjs.org'): string[] {
  const base = registry.replace(/\/+$/, '')
  if (base === 'https://registry.npmmirror.com') return [base, 'https://registry.npmjs.org']
  if (base === 'https://registry.npmjs.org') return [base, 'https://registry.npmmirror.com']
  return [base]
}

export async function resolveClaudeNpmPackage(
  registry: string,
  requested: string
): Promise<{ version: string; toolSpec: string }> {
  const base = registry.replace(/\/+$/, '')
  const version = semverValid(requested) ?? requested
  const response = await net.fetch(`${base}/${PACKAGE_NAME}/${encodeURIComponent(version)}`, {
    signal: AbortSignal.timeout(30_000)
  })
  if (!response.ok) throw new Error(`Claude npm metadata request failed: HTTP ${response.status}`)
  const metadata = (await response.json()) as {
    name?: unknown
    version?: unknown
    dist?: { integrity?: unknown }
  }
  const resolved = typeof metadata.version === 'string' ? semverValid(metadata.version) : null
  if (metadata.name !== PACKAGE_NAME || !resolved || (semverValid(version) && resolved !== version)) {
    throw new Error('Claude npm metadata does not match the requested platform and version')
  }
  const integrity = metadata.dist?.integrity
  const digest = typeof integrity === 'string' ? /^sha512-([A-Za-z0-9+/]{86}==)$/.exec(integrity)?.[1] : undefined
  if (!digest) throw new Error('Claude npm package is missing a valid SHA-512 integrity digest')
  const options = {
    url: `${base}/${PACKAGE_NAME}/-/claude-code-win32-arm64-{{ version }}.tgz`,
    bin: 'claude.exe',
    strip_components: 1,
    checksum: `sha512:${Buffer.from(digest, 'base64').toString('hex')}`,
    version_list_url: `${base}/${PACKAGE_NAME}`,
    version_json_path: '$.versions.*.version'
  }
  // mise splits tool arguments on @ before parsing TOML option strings.
  const toolOptions = Object.entries(options)
    .map(([key, value]) => `${key}=${JSON.stringify(value).replaceAll('@', '\\u0040')}`)
    .join(',')
  // mise resolves the bare name through its aqua registry, which ignores these HTTP options.
  return { version: resolved, toolSpec: `http:claude[${toolOptions}]@${resolved}` }
}
