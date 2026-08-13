import * as fs from 'node:fs'
import * as path from 'node:path'

import { loggerService } from '@logger'
import { findExecutableInEnv } from '@main/utils/commandResolver'
import { findSkillMdPath, parseSkillMetadata } from '@main/utils/markdownParser'
import { executeCommand } from '@main/utils/processRunner'
import { getShellEnv } from '@main/utils/shellEnv'
import { ClawhubSkillDetailSchema } from '@shared/types/skill'
import { encodeGithubPath, parseGithubSkillUrl, resolveRefFromSegments } from '@shared/utils/skillMarketplace'
import { net } from 'electron'

import {
  assertSkillDirectoryWithinLimits,
  extractZip,
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
  await cloneRepository(repoUrl, tempDir)

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

  const { owner, repo, refAndDirectory } = location
  const repoUrl = `https://github.com/${owner}/${repo}`
  const { ref, oid, directoryPath } = await resolveGithubCommit(repoUrl, refAndDirectory)
  logger.info('Installing from GitHub', { owner, repo, ref, oid, directoryPath })

  const tempDir = await openTempDir()
  await fetchCommit(repoUrl, oid, directoryPath, tempDir)
  await assertUniqueSkillPath(tempDir, directoryPath)
  const skillDir = await resolveSkillDirectory(tempDir, null, directoryPath)
  await assertSkillDirectoryWithinLimits(skillDir)

  return {
    skillDir,
    // Keep the ref, not the commit, as the stored origin: a later install of the same skill has to
    // match this URL to be treated as an update rather than a foreign folder collision.
    sourceUrl: `${repoUrl}/tree/${encodeGithubPath(`${ref}/${directoryPath}`)}`
  }
}

async function fetchFromSkillsSh(
  identifier: string,
  openTempDir: () => Promise<string>
): Promise<Omit<FetchedSkill, 'tempDir'>> {
  const parts = identifier.split('/')
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new Error(`Invalid skills.sh identifier: ${identifier}`)
  }
  logger.info('Installing from skills.sh', { identifier })

  const [owner, repo, skillName] = parts
  const repoUrl = `https://github.com/${owner}/${repo}`
  const tempDir = await openTempDir()
  await cloneRepository(repoUrl, tempDir)

  return { skillDir: await resolveSkillDirectory(tempDir, skillName, null), sourceUrl: repoUrl }
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
  refAndDirectory: string[]
): Promise<{ ref: string; oid: string; directoryPath: string }> {
  const gitCommand = (await findExecutableInEnv('git')) ?? 'git'
  const output = await runGit(gitCommand, ['ls-remote', '--heads', '--tags', '--', repoUrl])
  const refs = output.split('\n').flatMap((line) => {
    const [oid, fullName] = line.split('\t').map((part) => part.trim())
    // `^{}` marks a tag's dereferenced commit; the tag itself is already listed.
    const match = fullName?.match(/^refs\/(heads|tags)\/(.+?)(?:\^\{\})?$/)
    if (!oid || !match || fullName.endsWith('^{}')) return []
    return [{ oid, namespace: match[1] as 'heads' | 'tags', name: match[2] }]
  })

  const resolution = resolveRefFromSegments(refs, refAndDirectory)
  switch (resolution.kind) {
    case 'resolved':
      return { ref: resolution.ref.name, oid: resolution.ref.oid, directoryPath: resolution.directoryPath }
    case 'repo-root':
      throw new Error(
        `"${resolution.ref.name}" is a ${resolution.ref.namespace === 'tags' ? 'tag' : 'branch'} in ${repoUrl}, ` +
          'so this URL points at a SKILL.md in the repository root — install a skill directory instead.'
      )
    case 'ambiguous':
      throw new Error(`${repoUrl} has both a branch and a tag named "${resolution.name}"; the URL cannot say which.`)
    case 'no-match': {
      const [head, ...rest] = refAndDirectory
      // A permalink names its commit outright, so no ref has to match for it to be exact.
      if (rest.length > 0 && /^[0-9a-f]{40}$/i.test(head)) {
        return { ref: head, oid: head.toLowerCase(), directoryPath: rest.join('/') }
      }
      throw new Error(`No branch or tag in ${repoUrl} matches "${refAndDirectory.join('/')}"`)
    }
  }
}

/**
 * Materialize one commit, and from it only the selected directory. Fetching the OID rather than a
 * ref name is what makes the install deterministic; the blob filter and sparse pattern keep an
 * unrelated multi-gigabyte repository from being written to disk on the way to one skill, and the
 * hardened env keeps it from hanging on a credential prompt or smudging LFS payloads.
 */
async function fetchCommit(repoUrl: string, oid: string, directoryPath: string, destDir: string): Promise<void> {
  const gitCommand = (await findExecutableInEnv('git')) ?? 'git'
  const git = (args: string[]) => runGit(gitCommand, ['-C', destDir, ...args])

  await fs.promises.mkdir(destDir, { recursive: true })
  await git(['init', '--quiet'])
  await git(['fetch', '--quiet', '--depth', '1', '--filter=blob:none', '--no-tags', '--', repoUrl, oid])
  // Leading `/` anchors the pattern at the repo root and keeps a directory named like an option
  // from being read as one.
  await git(['sparse-checkout', 'set', '--no-cone', `/${directoryPath}/`])
  await git(['checkout', '--quiet', 'FETCH_HEAD'])
}

/**
 * Refuse a tree whose paths collide once the filesystem folds case or normalizes Unicode. Such a
 * checkout merges two directories into one, so the containment checks would inspect bytes that are
 * not the ones the URL selected.
 */
async function assertUniqueSkillPath(repoDir: string, directoryPath: string): Promise<void> {
  const gitCommand = (await findExecutableInEnv('git')) ?? 'git'
  const output = await runGit(gitCommand, ['-C', repoDir, 'ls-tree', '-r', '--name-only', 'FETCH_HEAD'])
  const foldKey = (value: string) => value.normalize('NFC').toLowerCase()
  const wanted = foldKey(`${directoryPath}/`)

  const collisions = new Set<string>()
  for (const entry of output.split('\n')) {
    const line = entry.trim()
    if (!line || !foldKey(line).startsWith(wanted)) continue
    collisions.add(line.slice(0, line.indexOf('/', directoryPath.length)))
  }

  if (collisions.size > 1) {
    throw new Error(
      `The commit contains directories that collide with "${directoryPath}" once case and Unicode are ` +
        `normalized (${[...collisions].join(', ')}); refusing to install an ambiguous checkout.`
    )
  }
}

async function runGit(gitCommand: string, args: string[]): Promise<string> {
  const env = await getShellEnv()
  return executeCommand(gitCommand, args, {
    capture: true,
    timeout: GIT_COMMAND_TIMEOUT_MS,
    env: { ...env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1', GIT_ASKPASS: '', GCM_INTERACTIVE: 'never' }
  })
}

async function cloneRepository(repoUrl: string, destDir: string): Promise<void> {
  const gitCommand = (await findExecutableInEnv('git')) ?? 'git'

  const branch = await resolveDefaultBranch(gitCommand, repoUrl)
  if (branch) {
    await executeCommand(gitCommand, ['clone', '--depth', '1', '--branch', branch, '--', repoUrl, destDir])
    return
  }

  try {
    await executeCommand(gitCommand, ['clone', '--depth', '1', '--', repoUrl, destDir])
  } catch {
    await executeCommand(gitCommand, ['clone', '--depth', '1', '--branch', 'master', '--', repoUrl, destDir])
  }
}

async function resolveDefaultBranch(command: string, repoUrl: string): Promise<string | null> {
  try {
    const output = await executeCommand(command, ['ls-remote', '--symref', '--', repoUrl, 'HEAD'], { capture: true })
    const match = output.match(/ref: refs\/heads\/([^\s]+)/)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

async function reportInstall(owner: string, repo: string, skillName: string): Promise<void> {
  const url = `${CLAUDE_PLUGINS_API}/api/skills/${owner}/${repo}/${skillName}/install`
  await net.fetch(url, { method: 'POST' })
}
