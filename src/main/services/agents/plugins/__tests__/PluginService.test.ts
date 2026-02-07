import * as crypto from 'node:crypto'

import { type ResolvedSkill } from '@types'
import { describe, expect, it } from 'vitest'

/**
 * Test helper functions extracted from PluginService for testing.
 * These mirror the private method implementations in PluginService for isolated unit testing,
 * following the same pattern used for extractBaseRepoUrl and extractResolvedSkill above.
 * When modifying PluginService private methods, update the corresponding mirrors here.
 */

// extractBaseRepoUrl implementation
function extractBaseRepoUrl(url: string): string {
  // Match GitHub tree URLs: https://github.com/owner/repo/tree/branch/path
  const treeMatch = url.match(/^(https:\/\/github\.com\/[^/]+\/[^/]+)\/tree\//)
  if (treeMatch) {
    return treeMatch[1]
  }

  // Match GitHub blob URLs: https://github.com/owner/repo/blob/branch/path
  const blobMatch = url.match(/^(https:\/\/github\.com\/[^/]+\/[^/]+)\/blob\//)
  if (blobMatch) {
    return blobMatch[1]
  }

  // Already a base URL or other format, return as-is
  return url
}

// extractResolvedSkill implementation (matches PluginService signature)
function extractResolvedSkill(skills: ResolvedSkill[], skillName: string): ResolvedSkill | null {
  if (!skills || skills.length === 0) return null

  // Find the skill by name (case-insensitive)
  const skill = skills.find((s) => s.name.toLowerCase() === skillName.toLowerCase())
  return skill ?? skills[0] ?? null
}

describe('PluginService', () => {
  describe('extractBaseRepoUrl', () => {
    it('should extract base URL from GitHub tree URL with main branch', () => {
      const url = 'https://github.com/pytorch/pytorch/tree/main/.claude/skills/skill-writer'
      expect(extractBaseRepoUrl(url)).toBe('https://github.com/pytorch/pytorch')
    })

    it('should extract base URL from GitHub tree URL with master branch', () => {
      const url = 'https://github.com/owner/repo/tree/master/some/path'
      expect(extractBaseRepoUrl(url)).toBe('https://github.com/owner/repo')
    })

    it('should extract base URL from GitHub tree URL with custom branch', () => {
      const url = 'https://github.com/owner/repo/tree/feature/my-branch/path/to/file'
      expect(extractBaseRepoUrl(url)).toBe('https://github.com/owner/repo')
    })

    it('should extract base URL from GitHub blob URL', () => {
      const url = 'https://github.com/owner/repo/blob/main/README.md'
      expect(extractBaseRepoUrl(url)).toBe('https://github.com/owner/repo')
    })

    it('should return base URL as-is when already a base URL', () => {
      const url = 'https://github.com/owner/repo'
      expect(extractBaseRepoUrl(url)).toBe('https://github.com/owner/repo')
    })

    it('should return URL as-is when it has .git suffix', () => {
      const url = 'https://github.com/owner/repo.git'
      expect(extractBaseRepoUrl(url)).toBe('https://github.com/owner/repo.git')
    })

    it('should return non-GitHub URL as-is', () => {
      const url = 'https://gitlab.com/owner/repo/tree/main/path'
      expect(extractBaseRepoUrl(url)).toBe('https://gitlab.com/owner/repo/tree/main/path')
    })

    it('should handle URL with trailing slash in tree path', () => {
      const url = 'https://github.com/owner/repo/tree/main/'
      expect(extractBaseRepoUrl(url)).toBe('https://github.com/owner/repo')
    })
  })

  describe('extractResolvedSkill', () => {
    const mockSkills: ResolvedSkill[] = [
      {
        namespace: '@anthropics/skills/skill-writer',
        name: 'skill-writer',
        relDir: '.claude/skills/skill-writer',
        sourceUrl: 'https://github.com/anthropics/skills/tree/main/.claude/skills/skill-writer'
      },
      {
        namespace: '@anthropics/skills/code-reviewer',
        name: 'code-reviewer',
        relDir: '.claude/skills/code-reviewer',
        sourceUrl: 'https://github.com/anthropics/skills/tree/main/.claude/skills/code-reviewer'
      }
    ]

    it('should find skill by exact name match', () => {
      const result = extractResolvedSkill(mockSkills, 'skill-writer')
      expect(result).toEqual(mockSkills[0])
    })

    it('should find skill by name case-insensitively', () => {
      const result = extractResolvedSkill(mockSkills, 'SKILL-WRITER')
      expect(result).toEqual(mockSkills[0])
    })

    it('should find skill by name with mixed case', () => {
      const result = extractResolvedSkill(mockSkills, 'Code-Reviewer')
      expect(result).toEqual(mockSkills[1])
    })

    it('should return first skill when name not found', () => {
      const result = extractResolvedSkill(mockSkills, 'non-existent')
      expect(result).toEqual(mockSkills[0])
    })

    it('should return null when skills array is empty', () => {
      const result = extractResolvedSkill([], 'skill-writer')
      expect(result).toBeNull()
    })

    it('should return null when skills is null', () => {
      const result = extractResolvedSkill(null as unknown as ResolvedSkill[], 'skill-writer')
      expect(result).toBeNull()
    })

    it('should return null when skills is undefined', () => {
      const result = extractResolvedSkill(undefined as unknown as ResolvedSkill[], 'skill-writer')
      expect(result).toBeNull()
    })
  })

  describe('truncateWithHash', () => {
    const MAX_NAME_LENGTH = 80

    // Mirrors PluginService.truncateWithHash
    function truncateWithHash(name: string, maxLength: number): string {
      if (name.length <= maxLength) return name
      if (maxLength <= 9) return name.slice(0, maxLength)
      const hash = crypto.createHash('sha256').update(name).digest('hex').slice(0, 8)
      const truncated = name.slice(0, maxLength - 9).replace(/[-_]+$/, '')
      return `${truncated}-${hash}`
    }

    it('should return short names unchanged', () => {
      expect(truncateWithHash('my-plugin', MAX_NAME_LENGTH)).toBe('my-plugin')
    })

    it('should return name at exactly max length unchanged', () => {
      const name = 'a'.repeat(MAX_NAME_LENGTH)
      expect(truncateWithHash(name, MAX_NAME_LENGTH)).toBe(name)
    })

    it('should truncate name exceeding max length', () => {
      const name = 'a'.repeat(MAX_NAME_LENGTH + 20)
      const result = truncateWithHash(name, MAX_NAME_LENGTH)
      expect(result.length).toBeLessThanOrEqual(MAX_NAME_LENGTH)
    })

    it('should append 8-char hash suffix', () => {
      const name = 'anthropic-awesome-claude-skills-my-advanced-data-processing-skill-with-very-long-descriptive-name'
      const result = truncateWithHash(name, MAX_NAME_LENGTH)
      expect(result).toMatch(/-[0-9a-f]{8}$/)
    })

    it('should be deterministic', () => {
      const name = 'a'.repeat(100)
      expect(truncateWithHash(name, MAX_NAME_LENGTH)).toBe(truncateWithHash(name, MAX_NAME_LENGTH))
    })

    it('should produce different results for different inputs', () => {
      const name1 = 'a'.repeat(100)
      const name2 = 'b'.repeat(100)
      expect(truncateWithHash(name1, MAX_NAME_LENGTH)).not.toBe(truncateWithHash(name2, MAX_NAME_LENGTH))
    })

    it('should strip trailing hyphens/underscores before hash', () => {
      // Create a name where truncation point falls on a separator
      const name = 'my-plugin' + '-'.repeat(MAX_NAME_LENGTH) + 'end'
      const result = truncateWithHash(name, MAX_NAME_LENGTH)
      expect(result).not.toMatch(/[-_]{2,}-[0-9a-f]{8}$/)
    })

    it('should fall back to simple slice when maxLength <= 9', () => {
      const name = 'a'.repeat(20)
      const result = truncateWithHash(name, 5)
      expect(result).toBe('aaaaa')
      expect(result.length).toBe(5)
    })
  })

  describe('sanitizeFolderName with truncation', () => {
    const MAX_NAME_LENGTH = 80

    // Mirrors PluginService.truncateWithHash
    function truncateWithHash(name: string, maxLength: number): string {
      if (name.length <= maxLength) return name
      if (maxLength <= 9) return name.slice(0, maxLength)
      const hash = crypto.createHash('sha256').update(name).digest('hex').slice(0, 8)
      const truncated = name.slice(0, maxLength - 9).replace(/[-_]+$/, '')
      return `${truncated}-${hash}`
    }

    function sanitizeFolderName(folderName: string): string {
      let sanitized = folderName.replace(/[/\\]/g, '_')
      sanitized = sanitized.replace(new RegExp(String.fromCharCode(0), 'g'), '')
      sanitized = sanitized.replace(/[^a-zA-Z0-9_-]/g, '_')
      sanitized = truncateWithHash(sanitized, MAX_NAME_LENGTH)
      return sanitized
    }

    it('should keep short folder names unchanged', () => {
      expect(sanitizeFolderName('my-skill')).toBe('my-skill')
    })

    it('should truncate long folder names', () => {
      const longName =
        'anthropic-awesome-claude-skills-my-advanced-data-processing-skill-with-very-long-descriptive-name'
      const result = sanitizeFolderName(longName)
      expect(result.length).toBeLessThanOrEqual(MAX_NAME_LENGTH)
    })

    it('should sanitize characters before truncating', () => {
      const name = 'my.plugin/with\\special@chars!' + 'x'.repeat(100)
      const result = sanitizeFolderName(name)
      expect(result.length).toBeLessThanOrEqual(MAX_NAME_LENGTH)
      expect(result).not.toMatch(/[^a-zA-Z0-9_-]/)
    })
  })

  describe('sanitizeFilename with truncation', () => {
    const MAX_NAME_LENGTH = 80

    function truncateWithHash(name: string, maxLength: number): string {
      if (name.length <= maxLength) return name
      if (maxLength <= 9) return name.slice(0, maxLength)
      const hash = crypto.createHash('sha256').update(name).digest('hex').slice(0, 8)
      const truncated = name.slice(0, maxLength - 9).replace(/[-_]+$/, '')
      return `${truncated}-${hash}`
    }

    // Mirrors PluginService.sanitizeFilename
    function sanitizeFilename(filename: string): string {
      let sanitized = filename.replace(/[/\\]/g, '_')
      sanitized = sanitized.replace(new RegExp(String.fromCharCode(0), 'g'), '')
      sanitized = sanitized.replace(/[^a-zA-Z0-9._-]/g, '_')

      if (!sanitized.endsWith('.md') && !sanitized.endsWith('.markdown')) {
        sanitized += '.md'
      }

      const ext = sanitized.endsWith('.markdown') ? '.markdown' : '.md'
      const baseName = sanitized.slice(0, -ext.length)
      const maxBaseLength = MAX_NAME_LENGTH - ext.length
      sanitized = truncateWithHash(baseName, maxBaseLength) + ext

      return sanitized
    }

    it('should keep short filenames unchanged', () => {
      expect(sanitizeFilename('my-agent.md')).toBe('my-agent.md')
    })

    it('should truncate long filenames while preserving .md extension', () => {
      const longName = 'a'.repeat(100) + '.md'
      const result = sanitizeFilename(longName)
      expect(result.length).toBeLessThanOrEqual(MAX_NAME_LENGTH)
      expect(result).toMatch(/\.md$/)
    })

    it('should truncate long filenames while preserving .markdown extension', () => {
      const longName = 'a'.repeat(100) + '.markdown'
      const result = sanitizeFilename(longName)
      expect(result.length).toBeLessThanOrEqual(MAX_NAME_LENGTH)
      expect(result).toMatch(/\.markdown$/)
    })

    it('should add .md extension if missing before truncating', () => {
      const longName = 'a'.repeat(100)
      const result = sanitizeFilename(longName)
      expect(result.length).toBeLessThanOrEqual(MAX_NAME_LENGTH)
      expect(result).toMatch(/\.md$/)
    })

    it('should handle empty base name (input is just .md)', () => {
      const result = sanitizeFilename('.md')
      expect(result).toBe('.md')
    })
  })
})
