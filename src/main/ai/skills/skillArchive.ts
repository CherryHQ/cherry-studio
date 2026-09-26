import * as fs from 'node:fs'
import * as path from 'node:path'

import StreamZip from 'node-stream-zip'

import { loggerService } from '@logger'
import { isOutsidePath } from '@main/utils/file'
import { findAllSkillDirectories, findSkillMdPath, parseSkillMetadata } from '@main/utils/markdownParser'
import { assertZipEntriesWithin } from '@main/utils/zipSafety'

/**
 * Handling for an untrusted skill tree on disk, however it arrived — an extracted ZIP or a shallow
 * clone. Owns the extraction ceilings and every containment check that decides which directory in
 * that tree is the skill being installed.
 */

const logger = loggerService.withContext('SkillArchive')

/** What one installed skill may weigh — the directory holding SKILL.md is all that reaches the library. */
export const MAX_SKILL_SIZE = 100 * 1024 * 1024 // 100MB
export const MAX_SKILL_FILES = 20_000
/**
 * What may be unpacked while looking for that skill. An archive is routinely a repository zipball
 * carrying one skill plus the whole repository around it, none of which is installed, so this bounds
 * the temp directory rather than the skill.
 */
export const MAX_ARCHIVE_SIZE = 1024 * 1024 * 1024 // 1GB
export const MAX_ARCHIVE_ENTRIES = 50_000

export async function validateZipFile(zipFilePath: string): Promise<void> {
  const stats = await fs.promises.stat(zipFilePath)
  if (!stats.isFile()) {
    throw new Error(`Not a file: ${zipFilePath}`)
  }
  if (!zipFilePath.toLowerCase().endsWith('.zip')) {
    throw new Error(`Not a ZIP file: ${zipFilePath}`)
  }
}

export async function extractZip(zipFilePath: string, destDir: string): Promise<void> {
  const zip = new StreamZip.async({ file: zipFilePath })

  try {
    const entries = Object.values(await zip.entries())
    assertZipEntriesWithin(
      entries.map((entry) => entry.name),
      destDir
    )
    // Measure the whole archive before rejecting it. Stopping at the entry that crosses a ceiling
    // reports the running counter — always the limit plus one entry — so an archive many times
    // over the limit reads as barely over it, and the user cannot tell why the install failed.
    // The central directory is already parsed and in memory here, so the full scan costs no I/O.
    const totalSize = entries.reduce((sum, entry) => sum + entry.size, 0)

    if (totalSize > MAX_ARCHIVE_SIZE) {
      throw new Error(
        `Skill archive expands to ${totalSize} bytes when extracted, over the ${MAX_ARCHIVE_SIZE}-byte limit`
      )
    }
    if (entries.length > MAX_ARCHIVE_ENTRIES) {
      throw new Error(`Skill archive contains ${entries.length} entries, over the ${MAX_ARCHIVE_ENTRIES}-entry limit`)
    }

    await zip.extract(null, destDir)
  } finally {
    await zip.close()
  }
}

/**
 * Bound what actually gets installed. Every install path converges here once its skill directory
 * is known, so the ceilings measure the skill rather than whatever archive or repository carried
 * it. Measuring the whole directory before rejecting keeps the error honest: stopping at the file
 * that crosses a ceiling would report the limit plus one file instead of the real total.
 */
export async function assertSkillDirectoryWithinLimits(skillDir: string): Promise<void> {
  let totalSize = 0
  let fileCount = 0

  const walk = async (directory: string): Promise<void> => {
    for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(entryPath)
        continue
      }
      if (!entry.isFile()) continue

      fileCount += 1
      totalSize += (await fs.promises.stat(entryPath)).size
    }
  }

  await walk(skillDir)

  if (totalSize > MAX_SKILL_SIZE) {
    throw new Error(`Skill holds ${totalSize} bytes, over the ${MAX_SKILL_SIZE}-byte limit`)
  }
  if (fileCount > MAX_SKILL_FILES) {
    throw new Error(`Skill holds ${fileCount} files, over the ${MAX_SKILL_FILES}-file limit`)
  }
}

/**
 * A symlinked component silently redirects the requested path elsewhere in the repository, so an
 * explicitly selected directory would install a skill other than the one shown to the user. The
 * realpath containment check alone cannot see this: the target stays inside the repository.
 */
async function assertNoSymlinkComponents(repoDir: string, relativePath: string): Promise<void> {
  let current = repoDir
  for (const part of relativePath.split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    const stats = await fs.promises.lstat(current).catch(() => null)
    if (stats?.isSymbolicLink()) {
      throw new Error(`Skill directory path passes through a symlink: ${relativePath}`)
    }
  }
}

export async function resolveSkillDirectory(
  repoDir: string,
  skillName: string | null,
  directoryPath: string | null
): Promise<string> {
  if (directoryPath) {
    const resolved = path.resolve(repoDir, directoryPath)
    // Reject a directoryPath that escapes the clone root — a crafted identifier could otherwise
    // point install at an arbitrary local directory (path traversal).
    const relative = path.relative(repoDir, resolved)
    if (isOutsidePath(relative)) {
      throw new Error(`Skill directory path escapes the repository: ${directoryPath}`)
    }
    await assertNoSymlinkComponents(repoDir, relative)
    const skillMdPath = await findSkillMdPath(resolved)
    if (skillMdPath) return validateRepositorySkillDirectory(repoDir, resolved, skillMdPath)

    // Fail closed: an explicit directoryPath with no SKILL.md must NOT fall back to guessing a
    // different candidate in the repo — the user confirmed skill A and must not get skill B.
    throw new Error(`No SKILL.md found at the specified skill directory: ${directoryPath}`)
  }

  const candidates = await findAllSkillDirectories(repoDir, repoDir, 8)

  if (skillName) {
    const matches: typeof candidates = []
    for (const candidate of candidates) {
      try {
        const metadata = await parseSkillMetadata(
          candidate.folderPath,
          candidate.sourcePath || path.basename(candidate.folderPath),
          'skills',
          { calculateSize: false }
        )
        if (metadata.name === skillName) matches.push(candidate)
      } catch (error) {
        logger.warn('Failed to parse repository skill candidate', {
          folderPath: candidate.folderPath,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    if (matches.length === 1) {
      return validateRepositorySkillDirectory(repoDir, matches[0].folderPath)
    }
    if (matches.length > 1) {
      throw new Error(`Multiple SKILL.md files declare the specified skill: ${skillName}`)
    }
    throw new Error(`No SKILL.md found for the specified skill: ${skillName}`)
  }

  if (candidates.length === 1) {
    return validateRepositorySkillDirectory(repoDir, candidates[0].folderPath)
  }

  if (candidates.length > 0) {
    logger.warn('resolveSkillDirectory: fallback to first candidate', {
      directoryPath,
      skillName,
      candidateCount: candidates.length,
      selected: candidates[0].folderPath
    })
    return validateRepositorySkillDirectory(repoDir, candidates[0].folderPath)
  }

  const rootSkill = await findSkillMdPath(repoDir)
  if (rootSkill) return validateRepositorySkillDirectory(repoDir, repoDir, rootSkill)

  throw new Error(`No skill directory found in ${repoDir}`)
}

export async function validateRepositorySkillDirectory(
  repoDir: string,
  skillDir: string,
  knownSkillMdPath?: string
): Promise<string> {
  const [repoRealPath, skillRealPath] = await Promise.all([
    fs.promises.realpath(repoDir),
    fs.promises.realpath(skillDir)
  ])
  const relativeSkillPath = path.relative(repoRealPath, skillRealPath)
  if (isOutsidePath(relativeSkillPath)) {
    throw new Error(`Skill directory resolves outside the repository: ${skillDir}`)
  }

  const skillMdPath = knownSkillMdPath ?? (await findSkillMdPath(skillRealPath))
  if (!skillMdPath) throw new Error(`No SKILL.md found in ${skillDir}`)
  const skillMdRealPath = await fs.promises.realpath(skillMdPath)
  const relativeDescriptorPath = path.relative(repoRealPath, skillMdRealPath)
  if (isOutsidePath(relativeDescriptorPath)) {
    throw new Error(`Skill descriptor resolves outside the repository: ${skillMdPath}`)
  }
  return skillRealPath
}
