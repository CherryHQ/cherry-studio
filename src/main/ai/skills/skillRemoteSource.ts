import * as fs from 'node:fs'
import * as path from 'node:path'

import { net } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import { getProxyEnvironment } from '@main/services/proxy/proxyEnv'
import { findExecutableInEnv } from '@main/utils/commandResolver'
import { findSkillMdPath, parseSkillMetadata } from '@main/utils/markdownParser'
import { CommandOutputLimitError, executeCommand } from '@main/utils/processRunner'
import { getShellEnv } from '@main/utils/shellEnv'
import { BINARY_INSTALL_PREFERENCE_KEY } from '@shared/data/presets/binaryTools'
import { ClawhubSkillDetailSchema } from '@shared/types/skill'
import { encodeGithubPath, parseGithubSkillUrl } from '@shared/utils/skillMarketplace'

import {
  assertSkillDirectoryWithinLimits,
  extractZip,
  MAX_SKILL_FILES,
  MAX_SKILL_SIZE,
  resolveSkillDirectory,
  validateRepositorySkillDirectory
} from './skillArchive'
import { createTempDir, safeRemoveDirectory, sanitizeFolderName } from './skillPaths'

/**
 * Acquisition of a marketplace skill into a caller-owned temp directory. Nothing here touches the
 * catalog or the library mutation lock: the caller commits the fetched directory and disposes of the
 * temp workspace.
 */

const logger = loggerService.withContext('SkillRemoteSource')

// API base URLs for the 3 search sources
const CLAUDE_PLUGINS_API = 'https://api.claude-plugins.dev'
// A direct-URL install points git at a repository nobody vetted; no single step may hang forever.
const GIT_COMMAND_TIMEOUT_MS = 2 * 60 * 1000
// chromium/chromium lists ~2.4 MiB of refs; the cap only stops output that a hostile repository can
// grow without end.
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024
const MAX_CLAWHUB_DETAIL_BYTES = 1024 * 1024

type GithubRef = {
  name: string
  oid: string
  namespace: 'heads' | 'tags'
}

type GithubSkillTarget = { kind: 'root' } | { kind: 'directory'; path: string }

type SkillDescriptorFileName = 'SKILL.md' | 'skill.md'

const SKILL_DESCRIPTOR_FILE_NAMES: readonly SkillDescriptorFileName[] = ['SKILL.md', 'skill.md']

type FetchedGithubCommit = {
  gitDir: string
  tempDir: string
  git: (args: string[]) => Promise<string>
}

type GithubRefResolution =
  | { kind: 'resolved'; ref: GithubRef; target: GithubSkillTarget }
  | { kind: 'ambiguous'; name: string }
  | { kind: 'no-match' }

function resolveGithubRef(refs: readonly GithubRef[], refAndPath: readonly string[]): GithubRefResolution {
  const refsByName = new Map<string, GithubRef[]>()
  for (const ref of refs) {
    refsByName.set(ref.name, [...(refsByName.get(ref.name) ?? []), ref])
  }

  for (let length = refAndPath.length; length >= 1; length--) {
    const name = refAndPath.slice(0, length).join('/')
    const matches = refsByName.get(name)
    if (!matches?.length) continue
    if (matches.length > 1) return { kind: 'ambiguous', name }

    return {
      kind: 'resolved',
      ref: matches[0],
      target:
        length === refAndPath.length
          ? { kind: 'root' }
          : { kind: 'directory', path: refAndPath.slice(length).join('/') }
    }
  }
  return { kind: 'no-match' }
}

export interface FetchedSkill {
  /** Temp workspace holding the checkout; the caller removes it once the install has committed. */
  tempDir: string
  skillDir: string
  sourceUrl: string
  /** Fire-and-forget notification to run once the install has committed. */
  onInstalled?: () => void
}

/** `openTempDir` is lazy so a malformed identifier is rejected before anything is written to disk. */
type Fetcher = (identifier: string, openTempDir: () => Promise<string>) => Promise<Omit<FetchedSkill, 'tempDir'>>

const FETCHERS: Record<string, Fetcher> = {
  'claude-plugins': fetchFromClaudePlugins,
  'skills.sh': fetchFromSkillsSh,
  clawhub: fetchFromClawhub,
  github: fetchFromGithub
}

/**
 * Fetch from a marketplace installSource handle.
 * Format: "claude-plugins:{owner}/{repo}/{directoryPath}",
 * "skills.sh:{owner}/{repo}/{skillId}", "clawhub:{owner}/{slug}",
 * or "github:{https URL of the skill's SKILL.md}".
 */
export async function fetchRemoteSkill(source: string, identifier: string): Promise<FetchedSkill> {
  const fetcher = FETCHERS[source]
  if (!fetcher) {
    throw new Error(`Unknown install source: ${source}`)
  }

  // The prefix comes from the matched key, never from raw user input.
  let tempDir = ''
  const openTempDir = async () => (tempDir = await createTempDir(source.replace(/[^a-zA-Z0-9-]/g, '-')))

  try {
    const fetched = await fetcher(identifier, openTempDir)
    return { tempDir, ...fetched }
  } catch (error) {
    if (tempDir) await safeRemoveDirectory(tempDir)
    throw error
  }
}

async function fetchFromClaudePlugins(
  identifier: string,
  openTempDir: () => Promise<string>
): Promise<Omit<FetchedSkill, 'tempDir'>> {
  const parts = identifier.split('/')
  const [owner, repo, ...directoryParts] = parts
  const directoryPath = directoryParts.join('/')
  const skillName = directoryParts[directoryParts.length - 1] ?? ''

  const invalidRepositoryPart = (part: string) =>
    !part || part === '.' || part === '..' || !/^[a-zA-Z0-9_.-]+$/.test(part)
  const invalidDirectoryPart = (part: string) =>
    !part || part !== part.trim() || part === '.' || part === '..' || part.includes('\\') || part.includes('\0')

  if (
    invalidRepositoryPart(owner) ||
    invalidRepositoryPart(repo) ||
    !directoryPath ||
    !skillName ||
    directoryParts.some(invalidDirectoryPart)
  ) {
    throw new Error(`Invalid claude-plugins identifier: ${identifier}`)
  }

  const repoUrl = `https://github.com/${owner}/${repo}`
  const tempDir = await openTempDir()
  const commit = await fetchGithubCommit(getGithubTransportUrl(repoUrl), 'HEAD', tempDir)
  const { contentDir, skillDir: targetDir } = await materializeGithubTarget(
    commit,
    { kind: 'directory', path: directoryPath },
    SKILL_DESCRIPTOR_FILE_NAMES
  )
  const skillDir = await validateRepositorySkillDirectory(contentDir, targetDir)
  await assertSkillDirectoryWithinLimits(skillDir)

  return {
    skillDir,
    sourceUrl: `${repoUrl}/tree/main/${directoryPath}`,
    onInstalled: () => {
      reportInstall(owner, repo, skillName).catch((err) => {
        logger.warn('Failed to report install', { error: err instanceof Error ? err.message : String(err) })
      })
    }
  }
}

/**
 * Fetch the one skill a GitHub SKILL.md URL points at. No registry is involved: the URL carries
 * the repo and the path, and the shared parser is the same one the UI validates with.
 *
 * A GitHub URL has no delimiter between the ref and the path, so the boundary is resolved against
 * the repo's own refs. What gets fetched is the commit observed during that lookup, not the ref
 * name again: a branch that moves in between would otherwise hand over different content than the
 * one whose tree was inspected.
 */
async function fetchFromGithub(
  identifier: string,
  openTempDir: () => Promise<string>
): Promise<Omit<FetchedSkill, 'tempDir'>> {
  const location = parseGithubSkillUrl(identifier)
  if (!location) {
    throw new Error(`Invalid GitHub skill URL: ${identifier}`)
  }

  const { owner, repo, refNamespace, refAndPath, descriptorFileName } = location
  const repoUrl = `https://github.com/${owner}/${repo}`
  const transportRepoUrl = getGithubTransportUrl(repoUrl)
  const { ref, namespace, oid, target } = await resolveGithubCommit(transportRepoUrl, refAndPath, refNamespace)
  logger.info('Installing from GitHub', { owner, repo, ref, namespace, oid, target })

  const sourcePath = target.kind === 'root' ? ref : `${ref}/${target.path}`
  const sourceUrl = namespace
    ? `https://raw.githubusercontent.com/${owner}/${repo}/refs/${namespace}/${encodeGithubPath(`${sourcePath}/${descriptorFileName}`)}`
    : `${repoUrl}/blob/${encodeGithubPath(`${sourcePath}/${descriptorFileName}`)}`

  const tempDir = await openTempDir()
  const commit = await fetchGithubCommit(transportRepoUrl, oid, tempDir)
  const { contentDir, skillDir } = await materializeGithubTarget(commit, target, [descriptorFileName])
  await validateRepositorySkillDirectory(contentDir, skillDir, path.join(skillDir, descriptorFileName))
  await assertSkillDirectoryWithinLimits(skillDir)

  return { skillDir, sourceUrl }
}

async function fetchFromSkillsSh(
  identifier: string,
  openTempDir: () => Promise<string>
): Promise<Omit<FetchedSkill, 'tempDir'>> {
  const parts = identifier.split('/')
  if (
    parts.length !== 3 ||
    !parts.every((part) => /^[a-zA-Z0-9_.-]+$/.test(part)) ||
    parts.some((part) => part === '.' || part === '..')
  ) {
    throw new Error(`Invalid skills.sh identifier: ${identifier}`)
  }
  logger.info('Installing from skills.sh', { identifier })

  const [owner, repo, skillName] = parts
  const repoUrl = `https://github.com/${owner}/${repo}`
  const tempDir = await openTempDir()
  const commit = await fetchGithubCommit(getGithubTransportUrl(repoUrl), 'HEAD', tempDir)
  // skills.sh names the skill, not its directory: check out only the descriptors to find it.
  const descriptorDir = path.join(tempDir, 'descriptors')
  await checkoutSparse(commit, descriptorDir, SKILL_DESCRIPTOR_FILE_NAMES)
  const matchedDir = await resolveSkillDirectory(descriptorDir, skillName, null)
  const matchedPath = path.relative(await fs.promises.realpath(descriptorDir), matchedDir)
  const { contentDir, skillDir: targetDir } = await materializeGithubTarget(
    commit,
    matchedPath ? { kind: 'directory', path: matchedPath.split(path.sep).join('/') } : { kind: 'root' },
    SKILL_DESCRIPTOR_FILE_NAMES
  )
  const skillDir = await validateRepositorySkillDirectory(contentDir, targetDir)
  await assertSkillDirectoryWithinLimits(skillDir)
  return {
    skillDir,
    sourceUrl: `https://skills.sh/${identifier}`
  }
}

function getGithubTransportUrl(repoUrl: string): string {
  const value = application.get('PreferenceService').get(BINARY_INSTALL_PREFERENCE_KEY).githubMirror.trim()
  if (!value) return repoUrl

  let mirror: URL
  try {
    mirror = new URL(value)
    if (mirror.protocol !== 'http:' && mirror.protocol !== 'https:') throw new Error()
  } catch {
    throw new Error('GitHub mirror must be a valid HTTP(S) URL')
  }
  if (mirror.username || mirror.password) {
    throw new Error('GitHub mirror must not contain embedded credentials')
  }
  return `${mirror.toString().replace(/\/+$/, '')}/${repoUrl}`
}

async function fetchFromClawhub(
  identifier: string,
  openTempDir: () => Promise<string>
): Promise<Omit<FetchedSkill, 'tempDir'>> {
  const [ownerHandle, slug, ...extraParts] = identifier.split('/')
  const invalidPart = (part: string | undefined) => !part || !/^[a-zA-Z0-9_.-]+$/.test(part)
  if (extraParts.length > 0 || invalidPart(ownerHandle) || invalidPart(slug)) {
    throw new Error(`Invalid clawhub identifier: ${identifier}`)
  }

  const detailUrl = new URL(`https://clawhub.ai/api/v1/skills/${encodeURIComponent(slug)}`)
  detailUrl.searchParams.set('ownerHandle', ownerHandle)
  const detailResp = await net.fetch(detailUrl.toString(), {
    headers: { 'User-Agent': 'CherryStudio' }
  })

  if (!detailResp.ok) {
    throw new Error(`clawhub detail failed: HTTP ${detailResp.status}`)
  }

  const detailChunks: Uint8Array[] = []
  let detailBytes = 0
  for await (const chunk of detailResp.body as unknown as AsyncIterable<Uint8Array>) {
    detailBytes += chunk.byteLength
    if (detailBytes > MAX_CLAWHUB_DETAIL_BYTES) {
      throw new Error(`clawhub detail exceeds the ${MAX_CLAWHUB_DETAIL_BYTES}-byte limit`)
    }
    detailChunks.push(chunk)
  }
  const detailResult = ClawhubSkillDetailSchema.safeParse(
    JSON.parse(new TextDecoder().decode(Buffer.concat(detailChunks)))
  )
  if (!detailResult.success) {
    throw new Error('clawhub detail returned invalid metadata')
  }
  if (
    detailResult.data.skill.slug !== slug ||
    detailResult.data.owner?.handle.toLowerCase() !== ownerHandle.toLowerCase()
  ) {
    throw new Error(`clawhub detail did not match the requested skill: ${identifier}`)
  }

  const downloadUrl = new URL('https://clawhub.ai/api/v1/download')
  downloadUrl.searchParams.set('slug', slug)
  downloadUrl.searchParams.set('ownerHandle', ownerHandle)
  const downloadResp = await net.fetch(downloadUrl.toString(), {
    headers: { 'User-Agent': 'CherryStudio' }
  })

  if (!downloadResp.ok) {
    throw new Error(`clawhub download failed: HTTP ${downloadResp.status}`)
  }

  const advertisedSize = Number(downloadResp.headers.get('content-length') ?? NaN)
  if (Number.isFinite(advertisedSize) && advertisedSize > MAX_SKILL_SIZE) {
    await downloadResp.body?.cancel()
    throw new Error(`clawhub archive advertises ${advertisedSize} bytes, over the ${MAX_SKILL_SIZE}-byte limit`)
  }

  const tempDir = await openTempDir()
  const zipPath = path.join(tempDir, 'skill.zip')
  // Content-Length is server-controlled; the running count is what enforces the cap.
  const handle = await fs.promises.open(zipPath, 'w')
  try {
    let received = 0
    for await (const chunk of downloadResp.body as unknown as AsyncIterable<Uint8Array>) {
      received += chunk.byteLength
      if (received > MAX_SKILL_SIZE) {
        throw new Error(`clawhub archive exceeds the ${MAX_SKILL_SIZE}-byte limit`)
      }
      for (let offset = 0; offset < chunk.byteLength;) {
        offset += (await handle.write(chunk, offset)).bytesWritten
      }
    }
  } finally {
    await handle.close()
  }
  const extractDir = path.join(tempDir, sanitizeFolderName(slug))
  await fs.promises.mkdir(extractDir, { recursive: true })
  await extractZip(zipPath, extractDir)
  // ClawHub serves one published skill bundle whose descriptor is at the archive root. Nested
  // SKILL.md files are supporting content, not alternative install candidates.
  const skillMdPath = await findSkillMdPath(extractDir)
  if (!skillMdPath) {
    throw new Error(`No SKILL.md found at the clawhub archive root: ${identifier}`)
  }
  const skillDir = await validateRepositorySkillDirectory(extractDir, extractDir, skillMdPath)
  await assertSkillDirectoryWithinLimits(skillDir)
  const metadata = await parseSkillMetadata(skillDir, slug, 'skills', { calculateSize: false })
  if ((metadata.slug ?? metadata.name).toLowerCase() !== slug.toLowerCase()) {
    throw new Error(`clawhub archive did not match the requested skill: ${identifier}`)
  }

  return { skillDir, sourceUrl: `https://clawhub.ai/${ownerHandle}/skills/${slug}` }
}

/**
 * Ask the remote where the ref ends and which commit it points at. A branch name may contain `/`,
 * so `blob/feature/foo/skills/demo/SKILL.md` is only unambiguous once the repo's refs are known.
 * A commit permalink needs no ref and is the one identity that cannot drift.
 */
async function resolveGithubCommit(
  repoUrl: string,
  refAndPath: string[],
  refNamespace: 'heads' | 'tags' | null
): Promise<{ ref: string; namespace: 'heads' | 'tags' | null; oid: string; target: GithubSkillTarget }> {
  const gitCommand = await resolveGitCommand()
  const output = await runGit(gitCommand, ['ls-remote', '--heads', '--tags', '--', repoUrl]).catch((error: unknown) => {
    if (!(error instanceof CommandOutputLimitError)) throw error
    throw new Error(`${repoUrl} lists too many branches and tags to resolve "${refAndPath.join('/')}"`, {
      cause: error
    })
  })
  const refs = output.split('\n').flatMap((line) => {
    const [oid, fullName] = line.split('\t').map((part) => part.trim())
    // `^{}` marks a tag's dereferenced commit; the tag itself is already listed.
    const match = fullName?.match(/^refs\/(heads|tags)\/(.+?)(?:\^\{\})?$/)
    if (!oid || !match || fullName.endsWith('^{}')) return []
    return [{ oid, namespace: match[1] as 'heads' | 'tags', name: match[2] }]
  })

  const matchingRefs = refNamespace ? refs.filter((ref) => ref.namespace === refNamespace) : refs
  const resolution = resolveGithubRef(matchingRefs, refAndPath)
  switch (resolution.kind) {
    case 'resolved':
      return {
        ref: resolution.ref.name,
        namespace: resolution.ref.namespace,
        oid: resolution.ref.oid,
        target: resolution.target
      }
    case 'ambiguous':
      throw new Error(`${repoUrl} has both a branch and a tag named "${resolution.name}"; the URL cannot say which.`)
    case 'no-match': {
      const [head, ...rest] = refAndPath
      if (refNamespace === null && /^[0-9a-f]{40}$/i.test(head)) {
        const target: GithubSkillTarget =
          rest.length === 0 ? { kind: 'root' } : { kind: 'directory', path: rest.join('/') }
        return { ref: head, namespace: null, oid: head.toLowerCase(), target }
      }
      throw new Error(`No branch or tag in ${repoUrl} matches "${refAndPath.join('/')}"`)
    }
  }
}

/**
 * Fetch one commit's trees into a bare repository. File contents stay on the remote until a sparse
 * checkout asks for them, so a small skill in a large repository never downloads the rest.
 */
async function fetchGithubCommit(repoUrl: string, revision: string, tempDir: string): Promise<FetchedGithubCommit> {
  const gitCommand = await resolveGitCommand()
  const gitDir = path.join(tempDir, 'repo.git')
  const git = (args: string[]) => runGit(gitCommand, [`--git-dir=${gitDir}`, ...args])

  await runGit(gitCommand, ['init', '--bare', '--quiet', gitDir])
  await git(['fetch', '--quiet', '--depth', '1', '--filter=blob:none', '--no-tags', '--', repoUrl, revision])
  return { gitDir, tempDir, git }
}

/**
 * Check out only installable content into a work tree separate from the git dir, which keeps a
 * repository-root skill from copying `.git`.
 */
async function materializeGithubTarget(
  commit: FetchedGithubCommit,
  target: GithubSkillTarget,
  descriptorFileNames: readonly SkillDescriptorFileName[]
): Promise<{ contentDir: string; skillDir: string }> {
  const contentDir = path.join(commit.tempDir, 'content')
  // Sizes are left to the on-disk check after checkout: `ls-tree -l` fetches every blob one
  // round trip at a time, long enough for a 60-file skill to hit the git timeout.
  const tree = await commit.git([
    'ls-tree',
    '-r',
    '-z',
    '--full-tree',
    'FETCH_HEAD',
    ...(target.kind === 'root' ? [] : ['--', `:(top,literal)${target.path}`])
  ])
  assertGithubTargetTree(tree, target, descriptorFileNames)
  await checkoutSparse(commit, contentDir, [toSparsePattern(target)])

  return {
    contentDir,
    skillDir: target.kind === 'root' ? contentDir : path.join(contentDir, target.path)
  }
}

/**
 * `read-tree` under sparse patterns fetches every missing blob in one batch; a pathspec `checkout`
 * against a partial clone fetches them one round trip per file.
 */
async function checkoutSparse(
  commit: FetchedGithubCommit,
  workTree: string,
  patterns: readonly string[]
): Promise<void> {
  await fs.promises.mkdir(workTree, { recursive: true })
  await fs.promises.mkdir(path.join(commit.gitDir, 'info'), { recursive: true })
  await fs.promises.writeFile(
    path.join(commit.gitDir, 'info', 'sparse-checkout'),
    patterns.map((pattern) => `${pattern}\n`).join('')
  )
  await fs.promises.rm(path.join(commit.gitDir, 'index'), { force: true })
  await commit.git([`--work-tree=${workTree}`, '-c', 'core.sparseCheckout=true', 'read-tree', '-mu', 'FETCH_HEAD'])
}

function toSparsePattern(target: GithubSkillTarget): string {
  if (target.kind === 'root') return '/*'
  // One pattern per line: a decoded `%0A` in the path would otherwise add patterns of its own.
  if (/[\r\n]/.test(target.path)) {
    throw new Error(`Skill directory path contains a line break: ${JSON.stringify(target.path)}`)
  }
  return `/${target.path.replace(/[\\*?[\]!# ]/g, '\\$&')}/`
}

function assertGithubTargetTree(
  tree: string,
  target: GithubSkillTarget,
  descriptorFileNames: readonly SkillDescriptorFileName[]
): void {
  const foldKey = (value: string) => value.normalize('NFC').toLowerCase()
  const targetParts = target.kind === 'root' ? [] : target.path.split('/')

  const entryPaths = tree.split('\0').flatMap((record) => {
    if (!record) return []
    const tab = record.indexOf('\t')
    if (tab === -1) return []
    const [, type] = record.slice(0, tab).trim().split(/\s+/)
    if (type !== 'blob') return []
    const entryPath = record.slice(tab + 1)
    return [target.kind === 'root' ? entryPath : entryPath.split('/').slice(targetParts.length).join('/')]
  })

  const seenPaths = new Map<string, string>()
  for (const entryPath of entryPaths) {
    const parts = entryPath.split('/')
    for (let length = 1; length <= parts.length; length++) {
      const prefix = parts.slice(0, length).join('/')
      const key = parts.slice(0, length).map(foldKey).join('/')
      const previous = seenPaths.get(key)
      if (previous && previous !== prefix) {
        throw new Error(
          `The commit contains paths that collide once case and Unicode are normalized (${previous}, ${prefix}).`
        )
      }
      seenPaths.set(key, prefix)
    }
  }

  if (!entryPaths.some((entryPath) => descriptorFileNames.includes(entryPath as SkillDescriptorFileName))) {
    const descriptor = descriptorFileNames.join(' or ')
    const location = target.kind === 'root' ? descriptor : `${target.path}/${descriptor}`
    throw new Error(`No ${descriptor} found at the selected GitHub location: ${location}`)
  }
  if (entryPaths.length > MAX_SKILL_FILES) {
    throw new Error(`Skill holds ${entryPaths.length} files, over the ${MAX_SKILL_FILES}-file limit`)
  }
}

/**
 * The single entry point for every git subprocess an install spawns: bounded, non-interactive, and
 * routed through Cherry's proxy — which lives in the main process env, not in the captured login shell.
 */
async function runGit(gitCommand: string, args: string[]): Promise<string> {
  const env = await getShellEnv()
  return executeCommand(gitCommand, args, {
    capture: true,
    maxOutputBytes: MAX_GIT_OUTPUT_BYTES,
    timeout: GIT_COMMAND_TIMEOUT_MS,
    env: {
      ...env,
      ...getProxyEnvironment(process.env),
      GIT_TERMINAL_PROMPT: '0',
      GIT_LFS_SKIP_SMUDGE: '1',
      GIT_ASKPASS: '',
      GCM_INTERACTIVE: 'never'
    }
  })
}

async function resolveGitCommand(): Promise<string> {
  try {
    return (await findExecutableInEnv('git')) ?? 'git'
  } catch (err) {
    logger.warn('git lookup failed, falling back to bare git', {
      error: err instanceof Error ? err.message : String(err)
    })
    return 'git'
  }
}

async function reportInstall(owner: string, repo: string, skillName: string): Promise<void> {
  const url = `${CLAUDE_PLUGINS_API}/api/skills/${owner}/${repo}/${skillName}/install`
  await net.fetch(url, { method: 'POST' })
}
