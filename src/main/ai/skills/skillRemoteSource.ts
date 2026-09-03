import * as fs from 'node:fs'
import * as path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { getProxyEnvironment } from '@main/services/proxy/proxyEnv'
import { findExecutableInEnv } from '@main/utils/commandResolver'
import { findSkillMdPath, parseSkillMetadata } from '@main/utils/markdownParser'
import { executeCommand } from '@main/utils/processRunner'
import { getShellEnv } from '@main/utils/shellEnv'
import { BINARY_INSTALL_PREFERENCE_KEY } from '@shared/data/presets/binaryTools'
import { ClawhubSkillDetailSchema } from '@shared/types/skill'
import { encodeGithubPath, parseGithubSkillUrl } from '@shared/utils/skillMarketplace'
import { net } from 'electron'

import {
  assertSkillDirectoryWithinLimits,
  extractZip,
  MAX_EXTRACTED_SIZE,
  MAX_FILES_COUNT,
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
const MAX_GIT_TREE_OUTPUT_BYTES = 16 * 1024 * 1024

type GithubRef = {
  name: string
  oid: string
  namespace: 'heads' | 'tags'
}

type GithubSkillTarget = { kind: 'root' } | { kind: 'directory'; path: string }

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
  await cloneRepository(getGithubTransportUrl(repoUrl), tempDir)

  return {
    skillDir: await resolveSkillDirectory(tempDir, skillName, directoryPath),
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
  const { contentDir, skillDir } = await materializeGithubTarget(
    transportRepoUrl,
    oid,
    target,
    descriptorFileName,
    tempDir
  )
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
  await cloneRepository(getGithubTransportUrl(repoUrl), tempDir)
  const skillDir = await resolveSkillDirectory(tempDir, skillName, null)
  if (skillDir === (await fs.promises.realpath(tempDir))) {
    await fs.promises.rm(path.join(tempDir, '.git'), { recursive: true, force: true })
  }

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

  const detailResult = ClawhubSkillDetailSchema.safeParse(await detailResp.json())
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

  const tempDir = await openTempDir()
  const zipPath = path.join(tempDir, 'skill.zip')
  const buffer = Buffer.from(await downloadResp.arrayBuffer())
  await fs.promises.writeFile(zipPath, buffer)
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
  const gitCommand = (await findExecutableInEnv('git')) ?? 'git'
  const output = await runGit(gitCommand, ['ls-remote', '--heads', '--tags', '--', repoUrl])
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
 * Fetch one commit into a bare repository and check out only installable content into a separate
 * work tree. Keeping the two roots separate prevents a repository-root skill from copying `.git`.
 */
async function materializeGithubTarget(
  repoUrl: string,
  oid: string,
  target: GithubSkillTarget,
  descriptorFileName: 'SKILL.md' | 'skill.md',
  tempDir: string
): Promise<{ contentDir: string; skillDir: string }> {
  const gitCommand = (await findExecutableInEnv('git')) ?? 'git'
  const gitDir = path.join(tempDir, 'repo.git')
  const contentDir = path.join(tempDir, 'content')
  const git = (args: string[], options?: { maxOutputBytes?: number }) =>
    runGit(gitCommand, [`--git-dir=${gitDir}`, ...args], options)

  await fs.promises.mkdir(contentDir, { recursive: true })
  await runGit(gitCommand, ['init', '--bare', '--quiet', gitDir])
  await git(['fetch', '--quiet', '--depth', '1', '--filter=blob:none', '--no-tags', '--', repoUrl, oid])
  const pathspec = target.kind === 'root' ? '.' : `:(top,literal)${target.path}`
  const sizedTree = await git(
    ['ls-tree', '-lr', '-z', '--full-tree', 'FETCH_HEAD', ...(target.kind === 'root' ? [] : ['--', pathspec])],
    { maxOutputBytes: MAX_GIT_TREE_OUTPUT_BYTES }
  )
  assertGithubTargetTree(sizedTree, target, descriptorFileName)

  await runGit(gitCommand, [
    `--git-dir=${gitDir}`,
    `--work-tree=${contentDir}`,
    'checkout',
    '--quiet',
    'FETCH_HEAD',
    '--',
    pathspec
  ])

  return {
    contentDir,
    skillDir: target.kind === 'root' ? contentDir : path.join(contentDir, target.path)
  }
}

function assertGithubTargetTree(
  sizedTree: string,
  target: GithubSkillTarget,
  descriptorFileName: 'SKILL.md' | 'skill.md'
): void {
  const foldKey = (value: string) => value.normalize('NFC').toLowerCase()
  const targetParts = target.kind === 'root' ? [] : target.path.split('/')

  const sizedEntries = sizedTree.split('\0').flatMap((record) => {
    if (!record) return []
    const tab = record.indexOf('\t')
    if (tab === -1) return []
    const [, type, , rawSize] = record.slice(0, tab).trim().split(/\s+/)
    if (type !== 'blob' || !/^\d+$/.test(rawSize)) return []
    const entryPath = record.slice(tab + 1)
    const relativePath = target.kind === 'root' ? entryPath : entryPath.split('/').slice(targetParts.length).join('/')
    return [{ path: relativePath, size: Number(rawSize) }]
  })

  const seenPaths = new Map<string, string>()
  for (const entry of sizedEntries) {
    const parts = entry.path.split('/')
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

  if (!sizedEntries.some((entry) => entry.path === descriptorFileName)) {
    const location = target.kind === 'root' ? descriptorFileName : `${target.path}/${descriptorFileName}`
    throw new Error(`No ${descriptorFileName} found at the selected GitHub location: ${location}`)
  }
  if (sizedEntries.length > MAX_FILES_COUNT) {
    throw new Error(`Skill directory has too many files: exceeds ${MAX_FILES_COUNT}`)
  }
  const totalSize = sizedEntries.reduce((sum, entry) => sum + entry.size, 0)
  if (totalSize > MAX_EXTRACTED_SIZE) {
    throw new Error(`Skill directory too large: exceeds ${MAX_EXTRACTED_SIZE} bytes`)
  }
}

/**
 * The single entry point for every git subprocess an install spawns: bounded, non-interactive, and
 * routed through Cherry's proxy — which lives in the main process env, not in the captured login shell.
 */
async function runGit(gitCommand: string, args: string[], options?: { maxOutputBytes?: number }): Promise<string> {
  const env = await getShellEnv()
  return executeCommand(gitCommand, args, {
    capture: true,
    maxOutputBytes: options?.maxOutputBytes,
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

/**
 * One shallow clone of whatever the remote calls its default branch — which is what a bare
 * `git clone` already checks out, so resolving the branch first only adds a second way to hang.
 */
async function cloneRepository(repoUrl: string, destDir: string): Promise<void> {
  const gitCommand = (await findExecutableInEnv('git')) ?? 'git'
  await runGit(gitCommand, ['clone', '--depth', '1', '--', repoUrl, destDir])
}

async function reportInstall(owner: string, repo: string, skillName: string): Promise<void> {
  const url = `${CLAUDE_PLUGINS_API}/api/skills/${owner}/${repo}/${skillName}/install`
  await net.fetch(url, { method: 'POST' })
}
