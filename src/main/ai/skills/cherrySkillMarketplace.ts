import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { net } from 'electron'
import StreamZip from 'node-stream-zip'
import * as z from 'zod'

import { application } from '@application'
import { findAllSkillDirectories, parseSkillMetadata } from '@main/utils/markdownParser'
import {
  CherrySkillDetailSchema,
  CherrySkillPageSchema,
  type CherrySkill,
  type MarketplaceSkillMember,
  type MarketplaceSkillDetail,
  type MarketplaceSkillPage
} from '@shared/types/skillMarketplace'
import { CHERRY_SKILL_MARKETPLACE_URL, summarizeMarketplaceSkill } from '@shared/utils/cherrySkillMarketplace'

import { extractZip, MAX_EXTRACTED_SIZE, validateRepositorySkillDirectory } from './skillArchive'
import { createTempDir, safeRemoveDirectory, sanitizeFolderName } from './skillPaths'

async function readMarketplace<T>(url: string, read: (response: Response) => Promise<T>, timeout = 15_000): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await net.fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`CherryIN HTTP ${response.status}`)
    return await read(response)
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}

function summarizeSkill(skill: CherrySkill) {
  const cached = application.get('CacheService').getPersist('skill.marketplace.members')
  const members = z
    .array(z.object({ path: z.string(), name: z.string() }))
    .nonempty()
    .safeParse(cached?.[skill.id])
  return summarizeMarketplaceSkill(skill, members.success ? members.data : undefined)
}

export async function listMarketplaceSkills(input: { offset: number; limit: number }): Promise<MarketplaceSkillPage> {
  const url = new URL('/api/skills', CHERRY_SKILL_MARKETPLACE_URL)
  url.searchParams.set('limit', String(input.limit))
  url.searchParams.set('offset', String(input.offset))
  url.searchParams.set('sort', 'popular')
  const page = await readMarketplace(url.href, async (response) => CherrySkillPageSchema.parse(await response.json()))
  return { items: page.items.map(summarizeSkill), pagination: page.pagination }
}

export async function getMarketplaceSkill(id: string, readMembers = false): Promise<MarketplaceSkillDetail> {
  const skill = await readMarketplace(
    `${CHERRY_SKILL_MARKETPLACE_URL}/api/skills/${encodeURIComponent(id)}`,
    async (response) => CherrySkillDetailSchema.parse(await response.json())
  )
  if (skill.id !== id) throw new Error('CherryIN skill is unavailable')
  const detail = { ...summarizeSkill(skill), longDescription: skill.longDescription }
  if (readMembers && detail.hasPackage && !detail.membersKnown) {
    const downloaded = await downloadMarketplaceSkill(detail)
    await safeRemoveDirectory(downloaded.tempDir)
  }
  return { ...summarizeSkill(skill), longDescription: skill.longDescription }
}

// Check the archive before extraction: Windows may otherwise overwrite case-colliding entries.
async function validatePortableArchive(file: string): Promise<void> {
  const zip = new StreamZip.async({ file })
  try {
    const paths = new Map<string, string>()
    for (const entry of Object.values(await zip.entries())) {
      if (((entry.attr >>> 16) & 0o170000) === 0o120000) throw new Error('Skill packages cannot contain symlinks')
      const parts = entry.name.replace(/\/$/, '').split('/')
      for (let length = 1; length <= parts.length; length++) {
        const part = parts[length - 1]
        if (
          !part ||
          part === '.' ||
          part === '..' ||
          /[\p{Cc}\\:<>"|?*]/u.test(part) ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
        )
          throw new Error(`Unsupported skill package path: ${entry.name}`)
        const prefix = parts.slice(0, length).join('/')
        const key = prefix.normalize('NFC').toLowerCase()
        if (paths.has(key) && paths.get(key) !== prefix) throw new Error(`Conflicting skill package path: ${prefix}`)
        paths.set(key, prefix)
      }
    }
  } finally {
    await zip.close()
  }
}

export async function downloadMarketplaceSkill(skill: MarketplaceSkillDetail) {
  if (!skill.hasPackage) throw new Error('CherryIN skill has no installable package')
  const tempDir = await createTempDir('cherryin')
  try {
    const zipPath = path.join(tempDir, 'package.zip')
    await readMarketplace(
      `${CHERRY_SKILL_MARKETPLACE_URL}/api/skills/${encodeURIComponent(skill.id)}/download`,
      async (response) => {
        if (!response.body) throw new Error('Empty skill download')
        const reader = response.body.getReader()
        const file = await fs.open(zipPath, 'wx')
        let size = 0
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            size += value.byteLength
            if (size > MAX_EXTRACTED_SIZE) throw new Error('Skill download exceeds the size limit')
            await file.writeFile(value)
          }
        } finally {
          try {
            await reader.cancel()
          } finally {
            await file.close()
          }
        }
      },
      60_000
    )
    await validatePortableArchive(zipPath)
    const contentDir = path.join(tempDir, 'content')
    await fs.mkdir(contentDir)
    await extractZip(zipPath, contentDir)
    const candidates = await findAllSkillDirectories(contentDir, contentDir)
    if (!candidates.length) throw new Error('Skill package contains no skills')
    const isCollection = candidates.length > 1 || (skill.tags.includes('collection') && candidates[0].sourcePath !== '')
    const directories: Array<MarketplaceSkillDetail['members'][number] & { skillDir: string }> = []
    const folderNames = new Set<string>()
    for (const candidate of candidates) {
      const memberPath = isCollection ? candidate.sourcePath.split(path.sep).join('/') : ''
      let skillDir = await validateRepositorySkillDirectory(contentDir, candidate.folderPath)
      const metadata = await parseSkillMetadata(skillDir, memberPath, 'skills', { calculateSize: false })
      const folderName = sanitizeFolderName(isCollection ? metadata.filename : metadata.name)
      if (!folderName || folderNames.has(folderName.toLowerCase()))
        throw new Error(`Conflicting skill folder: ${folderName}`)
      folderNames.add(folderName.toLowerCase())
      if (!isCollection) {
        const stagedDir = path.join(tempDir, 'staged', folderName)
        await fs.mkdir(path.dirname(stagedDir))
        await fs.rename(skillDir, stagedDir)
        skillDir = stagedDir
      }
      directories.push({ path: memberPath, name: metadata.name, skillDir })
    }
    const members: MarketplaceSkillMember[] = directories.map(({ path, name }) => ({ path, name }))
    const cache = application.get('CacheService')
    cache.setPersist('skill.marketplace.members', {
      ...cache.getPersist('skill.marketplace.members'),
      [skill.id]: members
    })
    return { tempDir, directories }
  } catch (error) {
    await safeRemoveDirectory(tempDir)
    throw error
  }
}
