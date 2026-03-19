import { execFile } from 'node:child_process'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'

import type { SiteMeta } from '../types'
import { logger } from '../types'

const BB_DIR = join(homedir(), '.bb-browser')
const LOCAL_SITES_DIR = join(BB_DIR, 'sites')
const COMMUNITY_SITES_DIR = join(BB_DIR, 'bb-sites')
const COMMUNITY_REPO = 'https://github.com/epiral/bb-sites.git'
const LAST_UPDATE_FILE = join(BB_DIR, '.last-update')
const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000

// Mtime-based cache
let cachedSites: SiteMeta[] | null = null
let cachedLocalMtime = 0
let cachedCommunityMtime = 0

/**
 * Parse adapter metadata from JS file content.
 * Supports `/* @meta JSON * /` block with `// @tag value` fallback.
 */
export function parseSiteMeta(content: string, filePath: string, source: 'local' | 'community'): SiteMeta | null {
  const sitesDir = source === 'local' ? LOCAL_SITES_DIR : COMMUNITY_SITES_DIR
  const relPath = relative(sitesDir, filePath)
  const defaultName = relPath.replace(/\.js$/, '').replace(/\\/g, '/')

  // Parse /* @meta { ... } */ block
  const metaMatch = content.match(/\/\*\s*@meta\s*[\r\n]([\s\S]*?)\*\//)
  if (metaMatch) {
    try {
      const metaJson = JSON.parse(metaMatch[1])
      return {
        name: metaJson.name || defaultName,
        description: metaJson.description || '',
        domain: metaJson.domain || '',
        args: metaJson.args || {},
        capabilities: metaJson.capabilities,
        readOnly: metaJson.readOnly,
        example: metaJson.example,
        filePath,
        source
      }
    } catch {
      // JSON parse failed, fall through to @tag mode
    }
  }

  // Fallback: parse // @tag format
  const meta: SiteMeta = {
    name: defaultName,
    description: '',
    domain: '',
    args: {},
    filePath,
    source
  }

  const tagPattern = /\/\/\s*@(\w+)[ \t]+(.*)/g
  let match: RegExpExecArray | null
  while ((match = tagPattern.exec(content)) !== null) {
    const [, key, value] = match
    switch (key) {
      case 'name':
        meta.name = value.trim()
        break
      case 'description':
        meta.description = value.trim()
        break
      case 'domain':
        meta.domain = value.trim()
        break
      case 'args':
        for (const arg of value
          .trim()
          .split(/[,\s]+/)
          .filter(Boolean)) {
          meta.args[arg] = { required: true }
        }
        break
      case 'example':
        meta.example = value.trim()
        break
    }
  }

  return meta
}

/**
 * Recursively scan a directory for .js adapter files.
 */
export function scanSites(dir: string, source: 'local' | 'community'): SiteMeta[] {
  if (!existsSync(dir)) return []
  const sites: SiteMeta[] = []

  function walk(currentDir: string): void {
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(currentDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name)
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        walk(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        let content: string
        try {
          content = readFileSync(fullPath, 'utf-8')
        } catch {
          continue
        }
        const meta = parseSiteMeta(content, fullPath, source)
        if (meta) sites.push(meta)
      }
    }
  }

  walk(dir)
  return sites
}

/**
 * Get directory mtime safely (returns 0 if dir does not exist).
 */
function getDirMtime(dir: string): number {
  try {
    return statSync(dir).mtimeMs
  } catch {
    return 0
  }
}

/**
 * Get all available site adapters (local overrides community by name).
 * Uses mtime-based caching to avoid rescanning on every call.
 */
export function getAllSites(): SiteMeta[] {
  const localMtime = getDirMtime(LOCAL_SITES_DIR)
  const communityMtime = getDirMtime(COMMUNITY_SITES_DIR)

  if (cachedSites && localMtime === cachedLocalMtime && communityMtime === cachedCommunityMtime) {
    return cachedSites
  }

  const community = scanSites(COMMUNITY_SITES_DIR, 'community')
  const local = scanSites(LOCAL_SITES_DIR, 'local')

  const byName = new Map<string, SiteMeta>()
  for (const s of community) byName.set(s.name, s)
  for (const s of local) byName.set(s.name, s) // local overrides community

  const result = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name))

  cachedSites = result
  cachedLocalMtime = localMtime
  cachedCommunityMtime = communityMtime

  return result
}

/**
 * Find an adapter by exact name.
 */
export function findSite(name: string): SiteMeta | undefined {
  return getAllSites().find((s) => s.name === name)
}

/**
 * Search adapters by fuzzy match on name, description, and domain.
 */
export function searchSites(query: string): SiteMeta[] {
  const q = query.toLowerCase()
  return getAllSites().filter(
    (s) =>
      s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.domain.toLowerCase().includes(q)
  )
}

/**
 * Invalidate the mtime cache so the next getAllSites() rescans.
 */
export function invalidateCache(): void {
  cachedSites = null
  cachedLocalMtime = 0
  cachedCommunityMtime = 0
}

// ── Auto-update ──────────────────────────────────────────────────

/**
 * Promisified execFile helper.
 */
function execFileAsync(cmd: string, args: string[], options: { cwd?: string } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { ...options, timeout: 60_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${cmd} ${args.join(' ')} failed: ${stderr || error.message}`))
      } else {
        resolve(stdout)
      }
    })
  })
}

/**
 * Ensure the community sites directory is available.
 * Clones the repo if it does not exist.
 */
export async function ensureSitesAvailable(): Promise<string> {
  if (existsSync(join(COMMUNITY_SITES_DIR, '.git'))) {
    return 'Community adapters already available.'
  }

  logger.info('Cloning community site adapters...', { repo: COMMUNITY_REPO })
  mkdirSync(BB_DIR, { recursive: true })

  try {
    await execFileAsync('git', ['clone', COMMUNITY_REPO, COMMUNITY_SITES_DIR])
    invalidateCache()
    const sites = scanSites(COMMUNITY_SITES_DIR, 'community')
    logger.info('Community adapters cloned', { count: sites.length })
    return `Cloned ${sites.length} community adapters.`
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error('Failed to clone community adapters', { error: msg })
    return `Failed to clone community adapters: ${msg}. You can manually clone: git clone ${COMMUNITY_REPO} ~/.bb-browser/bb-sites`
  }
}

/**
 * Background update: async pull if last update was >24h ago.
 * Non-blocking — spawns detached git process.
 */
export function backgroundUpdate(): void {
  const gitDir = join(COMMUNITY_SITES_DIR, '.git')
  if (!existsSync(gitDir)) return

  // Check last update timestamp
  let lastUpdate = 0
  try {
    const content = readFileSync(LAST_UPDATE_FILE, 'utf-8').trim()
    lastUpdate = Number(content)
  } catch {
    // File doesn't exist or can't be read — treat as never updated
  }

  if (Date.now() - lastUpdate < UPDATE_INTERVAL_MS) return

  logger.info('Starting background update of community adapters')

  try {
    // Write timestamp first to avoid repeated triggers
    writeFileSync(LAST_UPDATE_FILE, String(Date.now()))
  } catch {
    // Non-critical
  }

  try {
    const child = spawn('git', ['pull', '--ff-only'], {
      cwd: COMMUNITY_SITES_DIR,
      stdio: 'ignore',
      detached: true
    })
    child.unref()
    // Cache invalidation happens naturally via mtime change after git pull completes
  } catch (error) {
    logger.warn('Background update spawn failed', {
      error: error instanceof Error ? error.message : String(error)
    })
  }
}
