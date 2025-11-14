import fs from 'fs/promises'
import path from 'path'
import semver from 'semver'

type UpgradeChannel = 'latest' | 'rc' | 'beta'
type UpdateMirror = 'github' | 'gitcode'

const CHANNELS: UpgradeChannel[] = ['latest', 'rc', 'beta']
const MIRRORS: UpdateMirror[] = ['github', 'gitcode']
const GITHUB_REPO = 'CherryHQ/cherry-studio'
const GITCODE_REPO = 'CherryHQ/cherry-studio'
const DEFAULT_FEED_TEMPLATES: Record<UpdateMirror, string> = {
  github: `https://github.com/${GITHUB_REPO}/releases/download/{{tag}}`,
  gitcode: `https://gitcode.com/${GITCODE_REPO}/releases/download/{{tag}}`
}
const GITCODE_LATEST_FALLBACK = 'https://releases.cherry-ai.com'

interface CliOptions {
  tag?: string
  configPath?: string
  segmentsPath?: string
  dryRun?: boolean
  skipReleaseChecks?: boolean
  isPrerelease?: boolean
}

interface ChannelTemplateConfig {
  feedTemplates?: Partial<Record<UpdateMirror, string>>
}

interface SegmentMatchRule {
  range?: string
  exact?: string[]
  excludeExact?: string[]
}

interface SegmentDefinition {
  id: string
  type: 'legacy' | 'breaking' | 'latest'
  match: SegmentMatchRule
  lockedVersion?: string
  minCompatibleVersion: string
  description: string
  channelTemplates?: Partial<Record<UpgradeChannel, ChannelTemplateConfig>>
}

interface SegmentMetadataFile {
  segments: SegmentDefinition[]
}

interface ChannelConfig {
  version: string
  feedUrls: Record<UpdateMirror, string>
}

interface VersionMetadata {
  segmentId: string
  segmentType?: string
}

interface VersionEntry {
  metadata?: VersionMetadata
  minCompatibleVersion: string
  description: string
  channels: Record<UpgradeChannel, ChannelConfig | null>
}

interface UpgradeConfigFile {
  lastUpdated: string
  versions: Record<string, VersionEntry>
}

interface ReleaseInfo {
  tag: string
  version: string
  channel: UpgradeChannel
}

interface UpdateVersionsResult {
  versions: Record<string, VersionEntry>
  updated: boolean
}

const ROOT_DIR = path.resolve(__dirname, '..')
const DEFAULT_CONFIG_PATH = path.join(ROOT_DIR, 'app-upgrade-config.json')
const DEFAULT_SEGMENTS_PATH = path.join(ROOT_DIR, 'config/app-upgrade-segments.json')

async function main() {
  const options = parseArgs()
  const releaseTag = resolveTag(options)
  const normalizedVersion = normalizeVersion(releaseTag)
  const releaseChannel = detectChannel(normalizedVersion)
  if (!releaseChannel) {
    console.warn(`[update-app-upgrade-config] Tag ${normalizedVersion} does not map to beta/rc/latest. Skipping.`)
    return
  }

  // Validate version format matches prerelease status
  if (options.isPrerelease !== undefined) {
    const hasPrereleaseSuffix = releaseChannel === 'beta' || releaseChannel === 'rc'

    if (options.isPrerelease && !hasPrereleaseSuffix) {
      console.warn(
        `[update-app-upgrade-config] ⚠️  Release marked as prerelease but version ${normalizedVersion} has no beta/rc suffix. Skipping.`
      )
      return
    }

    if (!options.isPrerelease && hasPrereleaseSuffix) {
      console.warn(
        `[update-app-upgrade-config] ⚠️  Release marked as latest but version ${normalizedVersion} has prerelease suffix (${releaseChannel}). Skipping.`
      )
      return
    }
  }

  const [config, segmentFile] = await Promise.all([
    readJson<UpgradeConfigFile>(options.configPath ?? DEFAULT_CONFIG_PATH),
    readJson<SegmentMetadataFile>(options.segmentsPath ?? DEFAULT_SEGMENTS_PATH)
  ])

  const segment = pickSegment(segmentFile.segments, normalizedVersion)
  if (!segment) {
    throw new Error(`Unable to find upgrade segment for version ${normalizedVersion}`)
  }

  if (segment.lockedVersion && segment.lockedVersion !== normalizedVersion) {
    throw new Error(`Segment ${segment.id} is locked to ${segment.lockedVersion}, but received ${normalizedVersion}`)
  }

  const releaseInfo: ReleaseInfo = {
    tag: formatTag(releaseTag),
    version: normalizedVersion,
    channel: releaseChannel
  }

  const { versions: updatedVersions, updated } = await updateVersions(
    config.versions,
    segment,
    releaseInfo,
    Boolean(options.skipReleaseChecks)
  )

  if (!updated) {
    throw new Error(
      `[update-app-upgrade-config] Feed URLs are not ready for ${releaseInfo.version} (${releaseInfo.channel}). Try again after the release mirrors finish syncing.`
    )
  }

  const updatedConfig: UpgradeConfigFile = {
    ...config,
    lastUpdated: new Date().toISOString(),
    versions: updatedVersions
  }

  const output = JSON.stringify(updatedConfig, null, 2) + '\n'

  if (options.dryRun) {
    console.log('Dry run enabled. Generated configuration:\n')
    console.log(output)
    return
  }

  await fs.writeFile(options.configPath ?? DEFAULT_CONFIG_PATH, output, 'utf-8')
  console.log(
    `✅ Updated ${path.relative(process.cwd(), options.configPath ?? DEFAULT_CONFIG_PATH)} for ${segment.id} (${releaseInfo.channel}) -> ${releaseInfo.version}`
  )
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2)
  const options: CliOptions = {}

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--tag') {
      options.tag = args[i + 1]
      i += 1
    } else if (arg === '--config') {
      options.configPath = args[i + 1]
      i += 1
    } else if (arg === '--segments') {
      options.segmentsPath = args[i + 1]
      i += 1
    } else if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--skip-release-checks') {
      options.skipReleaseChecks = true
    } else if (arg === '--is-prerelease') {
      options.isPrerelease = args[i + 1] === 'true'
      i += 1
    } else if (arg === '--help') {
      printHelp()
      process.exit(0)
    } else {
      console.warn(`Ignoring unknown argument "${arg}"`)
    }
  }

  if (options.skipReleaseChecks && !options.dryRun) {
    throw new Error('--skip-release-checks can only be used together with --dry-run')
  }

  return options
}

function printHelp() {
  console.log(`Usage: tsx scripts/update-app-upgrade-config.ts [options]

Options:
  --tag <tag>         Release tag (e.g. v2.1.6). Falls back to GITHUB_REF_NAME/RELEASE_TAG.
  --config <path>     Path to app-upgrade-config.json.
  --segments <path>   Path to app-upgrade-segments.json.
  --is-prerelease <true|false>  Whether this is a prerelease (validates version format).
  --dry-run           Print the result without writing to disk.
  --skip-release-checks  Skip release page availability checks (only valid with --dry-run).
  --help              Show this help message.`)
}

function resolveTag(options: CliOptions): string {
  const envTag = process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME ?? process.env.TAG_NAME
  const tag = options.tag ?? envTag

  if (!tag) {
    throw new Error('A release tag is required. Pass --tag or set RELEASE_TAG/GITHUB_REF_NAME.')
  }

  return tag
}

function normalizeVersion(tag: string): string {
  const cleaned = semver.clean(tag, { loose: true })
  if (!cleaned) {
    throw new Error(`Tag "${tag}" is not a valid semantic version`)
  }

  const valid = semver.valid(cleaned, { loose: true })
  if (!valid) {
    throw new Error(`Unable to normalize tag "${tag}" to a valid semantic version`)
  }

  return valid
}

function detectChannel(version: string): UpgradeChannel | null {
  const parsed = semver.parse(version, { loose: true, includePrerelease: true })
  if (!parsed) {
    return null
  }

  if (parsed.prerelease.length === 0) {
    return 'latest'
  }

  const label = String(parsed.prerelease[0]).toLowerCase()
  if (label === 'beta') {
    return 'beta'
  }
  if (label === 'rc') {
    return 'rc'
  }

  return null
}

async function readJson<T>(filePath: string): Promise<T> {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(filePath)
  const data = await fs.readFile(absolute, 'utf-8')
  return JSON.parse(data) as T
}

function pickSegment(segments: SegmentDefinition[], version: string): SegmentDefinition | null {
  for (const segment of segments) {
    if (matchesSegment(segment.match, version)) {
      return segment
    }
  }
  return null
}

function matchesSegment(matchRule: SegmentMatchRule, version: string): boolean {
  if (matchRule.exact && matchRule.exact.includes(version)) {
    return true
  }

  if (matchRule.excludeExact && matchRule.excludeExact.includes(version)) {
    return false
  }

  if (matchRule.range && !semver.satisfies(version, matchRule.range, { includePrerelease: true })) {
    return false
  }

  if (matchRule.exact) {
    return matchRule.exact.includes(version)
  }

  return Boolean(matchRule.range)
}

function formatTag(tag: string): string {
  if (tag.startsWith('refs/tags/')) {
    return tag.replace('refs/tags/', '')
  }
  return tag
}

async function updateVersions(
  versions: Record<string, VersionEntry>,
  segment: SegmentDefinition,
  releaseInfo: ReleaseInfo,
  skipReleaseValidation: boolean
): Promise<UpdateVersionsResult> {
  const versionsCopy: Record<string, VersionEntry> = { ...versions }
  const existingKey = findVersionKeyBySegment(versionsCopy, segment.id)
  const targetKey = resolveVersionKey(existingKey, segment, releaseInfo)
  const shouldRename = existingKey && existingKey !== targetKey

  let entry: VersionEntry
  if (existingKey) {
    entry = { ...versionsCopy[existingKey], channels: { ...versionsCopy[existingKey].channels } }
  } else {
    entry = createEmptyVersionEntry()
  }

  entry.channels = ensureChannelSlots(entry.channels)

  const channelUpdated = await applyChannelUpdate(entry, segment, releaseInfo, skipReleaseValidation)
  if (!channelUpdated) {
    return { versions, updated: false }
  }

  if (shouldRename && existingKey) {
    delete versionsCopy[existingKey]
  }

  entry.metadata = {
    segmentId: segment.id,
    segmentType: segment.type
  }
  entry.minCompatibleVersion = segment.minCompatibleVersion
  entry.description = segment.description

  versionsCopy[targetKey] = entry
  return {
    versions: sortVersionMap(versionsCopy),
    updated: true
  }
}

function findVersionKeyBySegment(versions: Record<string, VersionEntry>, segmentId: string): string | null {
  for (const [key, value] of Object.entries(versions)) {
    if (value.metadata?.segmentId === segmentId) {
      return key
    }
  }
  return null
}

function resolveVersionKey(existingKey: string | null, segment: SegmentDefinition, releaseInfo: ReleaseInfo): string {
  if (segment.lockedVersion) {
    return segment.lockedVersion
  }

  if (releaseInfo.channel === 'latest') {
    return releaseInfo.version
  }

  if (existingKey) {
    return existingKey
  }

  const baseVersion = getBaseVersion(releaseInfo.version)
  return baseVersion ?? releaseInfo.version
}

function getBaseVersion(version: string): string | null {
  const parsed = semver.parse(version, { loose: true, includePrerelease: true })
  if (!parsed) {
    return null
  }
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`
}

function createEmptyVersionEntry(): VersionEntry {
  return {
    minCompatibleVersion: '',
    description: '',
    channels: {
      latest: null,
      rc: null,
      beta: null
    }
  }
}

function ensureChannelSlots(
  channels: Record<UpgradeChannel, ChannelConfig | null>
): Record<UpgradeChannel, ChannelConfig | null> {
  return CHANNELS.reduce(
    (acc, channel) => {
      acc[channel] = channels[channel] ?? null
      return acc
    },
    {} as Record<UpgradeChannel, ChannelConfig | null>
  )
}

async function applyChannelUpdate(
  entry: VersionEntry,
  segment: SegmentDefinition,
  releaseInfo: ReleaseInfo,
  skipReleaseValidation: boolean
): Promise<boolean> {
  if (!CHANNELS.includes(releaseInfo.channel)) {
    throw new Error(`Unsupported channel "${releaseInfo.channel}"`)
  }

  const feedUrls = buildFeedUrls(segment, releaseInfo)

  if (skipReleaseValidation) {
    console.warn(
      `[update-app-upgrade-config] Skipping release availability validation for ${releaseInfo.version} (${releaseInfo.channel}).`
    )
  } else {
    const availability = await ensureReleaseAvailability(releaseInfo)
    if (!availability.github) {
      return false
    }
    if (releaseInfo.channel === 'latest' && !availability.gitcode) {
      console.warn(
        `[update-app-upgrade-config] gitcode release page not ready for ${releaseInfo.tag}. Falling back to ${GITCODE_LATEST_FALLBACK}.`
      )
      feedUrls.gitcode = GITCODE_LATEST_FALLBACK
    }
  }

  entry.channels[releaseInfo.channel] = {
    version: releaseInfo.version,
    feedUrls
  }

  return true
}

function buildFeedUrls(segment: SegmentDefinition, releaseInfo: ReleaseInfo): Record<UpdateMirror, string> {
  return MIRRORS.reduce(
    (acc, mirror) => {
      const template = resolveFeedTemplate(segment, releaseInfo, mirror)
      acc[mirror] = applyTemplate(template, releaseInfo)
      return acc
    },
    {} as Record<UpdateMirror, string>
  )
}

function resolveFeedTemplate(segment: SegmentDefinition, releaseInfo: ReleaseInfo, mirror: UpdateMirror): string {
  if (mirror === 'gitcode' && releaseInfo.channel !== 'latest') {
    return segment.channelTemplates?.[releaseInfo.channel]?.feedTemplates?.github ?? DEFAULT_FEED_TEMPLATES.github
  }

  return segment.channelTemplates?.[releaseInfo.channel]?.feedTemplates?.[mirror] ?? DEFAULT_FEED_TEMPLATES[mirror]
}

function applyTemplate(template: string, releaseInfo: ReleaseInfo): string {
  return template.replace(/{{\s*tag\s*}}/gi, releaseInfo.tag).replace(/{{\s*version\s*}}/gi, releaseInfo.version)
}

function sortVersionMap(versions: Record<string, VersionEntry>): Record<string, VersionEntry> {
  const sorted = Object.entries(versions).sort(([a], [b]) => semver.rcompare(a, b))
  return sorted.reduce(
    (acc, [version, entry]) => {
      acc[version] = entry
      return acc
    },
    {} as Record<string, VersionEntry>
  )
}

interface ReleaseAvailability {
  github: boolean
  gitcode: boolean
}

async function ensureReleaseAvailability(releaseInfo: ReleaseInfo): Promise<ReleaseAvailability> {
  const mirrorsToCheck: UpdateMirror[] = releaseInfo.channel === 'latest' ? MIRRORS : ['github']
  const availability: ReleaseAvailability = {
    github: false,
    gitcode: releaseInfo.channel === 'latest' ? false : true
  }

  for (const mirror of mirrorsToCheck) {
    const url = getReleasePageUrl(mirror, releaseInfo.tag)
    try {
      const response = await fetch(url, {
        method: mirror === 'github' ? 'HEAD' : 'GET',
        redirect: 'follow'
      })

      if (response.ok) {
        availability[mirror] = true
      } else {
        console.warn(
          `[update-app-upgrade-config] ${mirror} release not available for ${releaseInfo.tag} (status ${response.status}, ${url}).`
        )
        availability[mirror] = false
      }
    } catch (error) {
      console.warn(
        `[update-app-upgrade-config] Failed to verify ${mirror} release page for ${releaseInfo.tag} (${url}). Continuing.`,
        error
      )
      availability[mirror] = false
    }
  }

  return availability
}

function getReleasePageUrl(mirror: UpdateMirror, tag: string): string {
  if (mirror === 'github') {
    return `https://github.com/${GITHUB_REPO}/releases/tag/${encodeURIComponent(tag)}`
  }
  // Use latest.yml download URL for GitCode to check if release exists
  // Note: GitCode returns 401 for HEAD requests, so we use GET in ensureReleaseAvailability
  return `https://gitcode.com/${GITCODE_REPO}/releases/download/${encodeURIComponent(tag)}/latest.yml`
}

main().catch((error) => {
  console.error('❌ Failed to update app-upgrade-config:', error)
  process.exit(1)
})
