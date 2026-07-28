import type { LearningUnit } from '@shared/data/types/englishLearning'

function yaml(value: unknown): string {
  return JSON.stringify(value)
}

export function renderLearningUnitNote(unit: LearningUnit): string {
  const frontmatter = [
    '---',
    `cherry_id: ${yaml(unit.id)}`,
    `kind: ${yaml(unit.kind)}`,
    `english: ${yaml(unit.english)}`,
    `meaning: ${yaml(unit.meaning)}`,
    `cefr: ${yaml(unit.cefr)}`,
    `tags: ${yaml(['cherry-english', ...unit.tags])}`,
    `suspended: ${unit.suspended}`,
    `created_at: ${yaml(unit.createdAt)}`,
    `updated_at: ${yaml(unit.updatedAt)}`,
    '---'
  ]
  const sections = [
    `# ${unit.english}`,
    `## Meaning\n\n${unit.meaning}`,
    unit.usageNote ? `## Usage\n\n${unit.usageNote}` : null,
    unit.example ? `## Example\n\n> ${unit.example}` : null,
    '## Review\n\nReview state is managed by Cherry Studio. Open Cherry Studio to study or change this item.'
  ].filter((section): section is string => section !== null)
  return `${frontmatter.join('\n')}\n\n${sections.join('\n\n')}\n`
}

export function renderObsidianDashboard(): string {
  return `# Cherry English

> This vault is a read-only learning mirror. Cherry Studio is the source of truth.

## Active learning units

\`\`\`dataview
TABLE meaning AS "Meaning", kind AS "Kind", cefr AS "CEFR", updated_at AS "Updated"
FROM #cherry-english
WHERE suspended = false
SORT updated_at DESC
\`\`\`

## Recent daily practice

\`\`\`dataview
LIST
FROM "Daily"
SORT file.name DESC
LIMIT 14
\`\`\`
`
}

export function renderDailyLearningLog(input: {
  date: string
  reviews: Array<{ english: string; rating: string; direction: string }>
  practices: Array<{ mode: string; durationMs: number; scenario: string | null }>
}): string {
  const reviewLines =
    input.reviews.length > 0
      ? input.reviews.map((review) => `- ${review.english} — ${review.direction}, ${review.rating}`).join('\n')
      : '- No card reviews yet.'
  const practiceLines =
    input.practices.length > 0
      ? input.practices
          .map((practice) => {
            const minutes = Math.max(1, Math.round(practice.durationMs / 60_000))
            return `- ${practice.mode}${practice.scenario ? ` — ${practice.scenario}` : ''} (${minutes} min)`
          })
          .join('\n')
      : '- No speaking practice yet.'
  return `---
date: ${input.date}
tags: ["cherry-english-daily"]
---

# English Learning — ${input.date}

## Card reviews

${reviewLines}

## Speaking practice

${practiceLines}
`
}
