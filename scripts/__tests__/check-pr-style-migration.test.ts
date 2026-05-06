import { describe, expect, it } from 'vitest'

import {
  buildPullRequestStyleMigrationComment,
  parseAddedLegacyVarFindingsFromDiff,
  parseAddedLineNumbersFromDiff
} from '../check-pr-style-migration'

describe('check-pr-style-migration', () => {
  it('reports legacy vars only from added lines', () => {
    const diff = `
diff --git a/src/renderer/src/example.tsx b/src/renderer/src/example.tsx
index 1111111..2222222 100644
--- a/src/renderer/src/example.tsx
+++ b/src/renderer/src/example.tsx
@@ -10,0 +11,4 @@
+const css = 'color: var(--color-text-1);'
+// var(--color-text-2)
+const next = 'background: var(--color-background-soft);'
-const removed = 'color: var(--color-text-3);'
`

    const findings = parseAddedLegacyVarFindingsFromDiff(diff, 'src/renderer/src/example.tsx')

    expect(findings).toEqual([
      {
        file: 'src/renderer/src/example.tsx',
        line: 11,
        variable: '--color-text-1',
        lineText: "const css = 'color: var(--color-text-1);'"
      },
      {
        file: 'src/renderer/src/example.tsx',
        line: 13,
        variable: '--color-background-soft',
        lineText: "const next = 'background: var(--color-background-soft);'"
      }
    ])
  })

  it('tracks added line numbers from a unified diff', () => {
    const diff = `
diff --git a/src/renderer/src/example.tsx b/src/renderer/src/example.tsx
index 1111111..2222222 100644
--- a/src/renderer/src/example.tsx
+++ b/src/renderer/src/example.tsx
@@ -10,2 +10,4 @@
 const old = true
+const added = 'w-[420px]'
-const removed = true
+const next = 'min-h-[72px]'
 const unchanged = true
`

    expect([...parseAddedLineNumbersFromDiff(diff)]).toEqual([11, 12])
  })

  it('builds a PR comment body with a marker and summary', () => {
    const body = buildPullRequestStyleMigrationComment(
      [
        {
          file: 'src/renderer/src/example.tsx',
          line: 11,
          variable: '--color-text-1',
          lineText: "const css = 'color: var(--color-text-1);'"
        }
      ],
      [
        {
          file: 'src/renderer/src/example.tsx',
          line: 12,
          original: 'w-[420px]',
          canonical: 'w-105',
          lineText: '<div className="w-[420px]" />'
        }
      ]
    )

    expect(body).toContain('<!-- legacy-css-vars-warning -->')
    expect(body).toContain('## Style Migration Reminders')
    expect(body).toContain('### Legacy CSS Variables Detected')
    expect(body).toContain('`--color-text-1`')
    expect(body).toContain('### Tailwind Canonical Classes Detected')
    expect(body).toContain('`w-105` instead of `w-[420px]`')
    expect(body).toContain('Run `pnpm styles:canonical <path>` locally to rewrite them automatically.')
    expect(body).toContain('This is a migration reminder only and does not block the PR.')
  })
})
