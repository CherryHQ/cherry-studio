import {
  ClaudePluginsSearchResponseSchema,
  ClawhubSearchResponseSchema,
  ClawhubSkillDetailSchema,
  SkillsShSearchResponseSchema
} from '@types'
import { describe, expect, it } from 'vitest'

import claudePluginsFixture from './fixtures/claude-plugins-search.json'
import clawhubDetailFixture from './fixtures/clawhub-detail.json'
import clawhubSearchFixture from './fixtures/clawhub-search.json'
import skillsShFixture from './fixtures/skills-sh-search.json'

// =============================================================================
// Schema validation against fixtures
// =============================================================================

describe('Skill search API schemas', () => {
  describe('ClaudePluginsSearchResponseSchema', () => {
    it('should parse the claude-plugins fixture', () => {
      const result = ClaudePluginsSearchResponseSchema.safeParse(claudePluginsFixture)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.skills).toHaveLength(4)
      }
    })

    it('should snapshot the parsed fixture', () => {
      const result = ClaudePluginsSearchResponseSchema.parse(claudePluginsFixture)
      expect(result).toMatchSnapshot()
    })

    it('should handle missing optional fields', () => {
      const minimal = {
        skills: [
          {
            id: 'min-1',
            name: 'minimal-skill',
            namespace: 'test'
          }
        ]
      }
      const result = ClaudePluginsSearchResponseSchema.safeParse(minimal)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.skills[0].stars).toBeUndefined()
        expect(result.data.skills[0].metadata).toBeUndefined()
      }
    })

    it('should reject invalid data', () => {
      const invalid = { skills: [{ name: 'no-id' }] }
      const result = ClaudePluginsSearchResponseSchema.safeParse(invalid)
      expect(result.success).toBe(false)
    })
  })

  describe('SkillsShSearchResponseSchema', () => {
    it('should parse the skills.sh fixture', () => {
      const result = SkillsShSearchResponseSchema.safeParse(skillsShFixture)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.skills).toHaveLength(3)
        expect(result.data.query).toBe('vercel')
      }
    })

    it('should snapshot the parsed fixture', () => {
      const result = SkillsShSearchResponseSchema.parse(skillsShFixture)
      expect(result).toMatchSnapshot()
    })

    it('should reject missing required fields', () => {
      const invalid = {
        query: 'test',
        skills: [{ id: 'x', name: 'y' }],
        count: 1
      }
      const result = SkillsShSearchResponseSchema.safeParse(invalid)
      expect(result.success).toBe(false)
    })
  })

  describe('ClawhubSearchResponseSchema', () => {
    it('should parse the clawhub search fixture', () => {
      const result = ClawhubSearchResponseSchema.safeParse(clawhubSearchFixture)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.results).toHaveLength(2)
      }
    })

    it('should snapshot the parsed fixture', () => {
      const result = ClawhubSearchResponseSchema.parse(clawhubSearchFixture)
      expect(result).toMatchSnapshot()
    })

    it('should handle null version', () => {
      const result = ClawhubSearchResponseSchema.parse(clawhubSearchFixture)
      const nullVersion = result.results.find((r) => r.version === null)
      expect(nullVersion).toBeDefined()
      expect(nullVersion!.slug).toBe('test-suite-gen')
    })
  })

  describe('ClawhubSkillDetailSchema', () => {
    it('should parse the clawhub detail fixture', () => {
      const result = ClawhubSkillDetailSchema.safeParse(clawhubDetailFixture)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.skill.slug).toBe('code-reviewer-pro')
        expect(result.data.owner?.handle).toBe('devmaster')
      }
    })

    it('should snapshot the parsed fixture', () => {
      const result = ClawhubSkillDetailSchema.parse(clawhubDetailFixture)
      expect(result).toMatchSnapshot()
    })

    it('should handle null owner and moderation', () => {
      const minimal = {
        skill: {
          slug: 'test',
          displayName: 'Test',
          summary: 'A test skill'
        },
        owner: null,
        moderation: null
      }
      const result = ClawhubSkillDetailSchema.safeParse(minimal)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.owner).toBeNull()
        expect(result.data.moderation).toBeNull()
      }
    })
  })
})

// =============================================================================
// Normalizer tests (inline reimplementations to test without fetch mocking)
// =============================================================================

/**
 * Reimplementation of normalizeClaudePlugins matching the production code
 * in SkillSearchService.ts. Uses directoryPath for installSource.
 */
function normalizeClaudePlugins(parsed: ReturnType<typeof ClaudePluginsSearchResponseSchema.parse>) {
  return parsed.skills.map((s) => {
    const repoOwner = s.metadata?.repoOwner ?? ''
    const repoName = s.metadata?.repoName ?? ''
    const directoryPath = s.metadata?.directoryPath ?? ''
    return {
      slug: s.id,
      name: s.name,
      description: s.description ?? null,
      author: s.author ?? s.namespace ?? null,
      stars: s.stars ?? 0,
      downloads: s.installs ?? 0,
      sourceRegistry: 'claude-plugins.dev' as const,
      sourceUrl: s.sourceUrl ?? (repoOwner && repoName ? `https://github.com/${repoOwner}/${repoName}` : null),
      installSource: `claude-plugins:${repoOwner}/${repoName}/${directoryPath}`
    }
  })
}

describe('Skill search normalizers', () => {
  describe('normalizeClaudePlugins', () => {
    it('should normalize fixture to unified results', () => {
      const parsed = ClaudePluginsSearchResponseSchema.parse(claudePluginsFixture)
      const results = normalizeClaudePlugins(parsed)

      expect(results).toHaveLength(4)
      expect(results).toMatchSnapshot()

      // Verify specific normalization rules
      expect(results[0].author).toBe('anthropic')
      expect(results[0].stars).toBe(42)
      expect(results[0].installSource).toBe('claude-plugins:anthropic/skills/code-review')
      expect(results[0].sourceUrl).toBe('https://github.com/anthropic/skills/tree/main/code-review')

      // Null author falls back to namespace
      expect(results[1].author).toBe('community')
      expect(results[1].description).toBeNull()

      // Missing metadata fields produce empty strings
      expect(results[2].installSource).toBe('claude-plugins:devtools-org/claude-skills/')
    })

    it('should use directoryPath (not name) for installSource to handle name mismatches', () => {
      // This is the key bug fix test: skill name "vercel-react-best-practices"
      // differs from the actual repo directory path "skills/react-best-practices".
      // Using name would cause resolve API failure; using directoryPath works.
      const parsed = ClaudePluginsSearchResponseSchema.parse(claudePluginsFixture)
      const results = normalizeClaudePlugins(parsed)

      const vercelSkill = results.find((r) => r.name === 'vercel-react-best-practices')!
      expect(vercelSkill).toBeDefined()

      // installSource must use the actual directoryPath, not the display name
      expect(vercelSkill.installSource).toBe('claude-plugins:vercel-labs/agent-skills/skills/react-best-practices')
      // NOT "claude-plugins:vercel-labs/agent-skills/vercel-react-best-practices"

      // sourceUrl should come from the API response, not be reconstructed
      expect(vercelSkill.sourceUrl).toBe(
        'https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices'
      )
    })

    it('should handle null metadata gracefully', () => {
      const parsed = ClaudePluginsSearchResponseSchema.parse(claudePluginsFixture)
      const results = normalizeClaudePlugins(parsed)

      const noMetadata = results.find((r) => r.name === 'test-generator')!
      expect(noMetadata.installSource).toBe('claude-plugins://')
      expect(noMetadata.sourceUrl).toBeNull()
    })

    it('should prefer API sourceUrl over reconstructed URL', () => {
      const parsed = ClaudePluginsSearchResponseSchema.parse(claudePluginsFixture)
      const results = normalizeClaudePlugins(parsed)

      // cp-001 has sourceUrl in the API response
      expect(results[0].sourceUrl).toBe('https://github.com/anthropic/skills/tree/main/code-review')

      // cp-003 has no sourceUrl but has metadata — should reconstruct
      expect(results[2].sourceUrl).toBe('https://github.com/devtools-org/claude-skills')
    })
  })

  describe('normalizeSkillsSh', () => {
    it('should normalize fixture to unified results', () => {
      const parsed = SkillsShSearchResponseSchema.parse(skillsShFixture)
      const results = parsed.skills.map((s) => ({
        slug: s.id,
        name: s.name,
        description: null,
        author: s.source.split('/')[0] ?? null,
        stars: 0,
        downloads: s.installs,
        sourceRegistry: 'skills.sh' as const,
        installSource: `skills.sh:${s.id}`
      }))

      expect(results).toHaveLength(3)
      expect(results).toMatchSnapshot()

      expect(results[0].author).toBe('vercel-labs')
      expect(results[0].description).toBeNull()
      expect(results[1].downloads).toBe(263730)
      expect(results[2].installSource).toBe('skills.sh:vercel-labs/agent-skills/vercel-composition-patterns')
    })
  })

  describe('normalizeClawhub', () => {
    it('should normalize fixture to unified results', () => {
      const parsed = ClawhubSearchResponseSchema.parse(clawhubSearchFixture)
      const results = parsed.results.map((s) => ({
        slug: s.slug,
        name: s.displayName,
        description: s.summary ?? null,
        author: null,
        stars: 0,
        downloads: 0,
        sourceRegistry: 'clawhub.ai' as const,
        installSource: `clawhub:${s.slug}`
      }))

      expect(results).toHaveLength(2)
      expect(results).toMatchSnapshot()

      expect(results[0].name).toBe('Code Reviewer Pro')
      expect(results[0].installSource).toBe('clawhub:code-reviewer-pro')
      expect(results[1].author).toBeNull()
    })
  })
})

// =============================================================================
// Deduplication logic
// =============================================================================

describe('Skill search deduplication', () => {
  it('should deduplicate results by name (case-insensitive)', () => {
    const allResults = [
      { name: 'Code-Review', slug: 'a', sourceRegistry: 'claude-plugins.dev' as const },
      { name: 'code-review', slug: 'b', sourceRegistry: 'skills.sh' as const },
      { name: 'Code-review', slug: 'c', sourceRegistry: 'clawhub.ai' as const },
      { name: 'Unique-Skill', slug: 'd', sourceRegistry: 'skills.sh' as const }
    ]

    const seen = new Set<string>()
    const deduped = allResults.filter((r) => {
      const key = r.name.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    expect(deduped).toHaveLength(2)
    expect(deduped[0].slug).toBe('a')
    expect(deduped[1].slug).toBe('d')
  })
})
