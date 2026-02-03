import { describe, expect, it } from 'vitest'

/**
 * Test helper functions extracted from PluginService for testing
 * These are the same implementations as in PluginService, extracted for isolated testing
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

// extractResolvedSkill implementation
interface ResolvedSkill {
  namespace: string
  name: string
  relDir: string
  sourceUrl: string
}

function extractResolvedSkill(payload: { skills: ResolvedSkill[] }, skillName: string): ResolvedSkill | null {
  if (!payload?.skills || !Array.isArray(payload.skills)) return null

  // Find the skill by name (case-insensitive)
  const skill = payload.skills.find((s) => s.name.toLowerCase() === skillName.toLowerCase())
  return skill ?? payload.skills[0] ?? null
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
      const payload = { skills: mockSkills }
      const result = extractResolvedSkill(payload, 'skill-writer')
      expect(result).toEqual(mockSkills[0])
    })

    it('should find skill by name case-insensitively', () => {
      const payload = { skills: mockSkills }
      const result = extractResolvedSkill(payload, 'SKILL-WRITER')
      expect(result).toEqual(mockSkills[0])
    })

    it('should find skill by name with mixed case', () => {
      const payload = { skills: mockSkills }
      const result = extractResolvedSkill(payload, 'Code-Reviewer')
      expect(result).toEqual(mockSkills[1])
    })

    it('should return first skill when name not found', () => {
      const payload = { skills: mockSkills }
      const result = extractResolvedSkill(payload, 'non-existent')
      expect(result).toEqual(mockSkills[0])
    })

    it('should return null when skills array is empty', () => {
      const payload = { skills: [] }
      const result = extractResolvedSkill(payload, 'skill-writer')
      expect(result).toBeNull()
    })

    it('should return null when payload has no skills property', () => {
      const payload = {} as { skills: ResolvedSkill[] }
      const result = extractResolvedSkill(payload, 'skill-writer')
      expect(result).toBeNull()
    })

    it('should return null when skills is not an array', () => {
      const payload = { skills: 'not-an-array' } as unknown as { skills: ResolvedSkill[] }
      const result = extractResolvedSkill(payload, 'skill-writer')
      expect(result).toBeNull()
    })

    it('should return null when payload is null', () => {
      const result = extractResolvedSkill(null as unknown as { skills: ResolvedSkill[] }, 'skill-writer')
      expect(result).toBeNull()
    })
  })
})
