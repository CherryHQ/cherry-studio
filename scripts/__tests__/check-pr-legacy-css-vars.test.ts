import { describe, expect, it } from 'vitest'

import { buildPullRequestLegacyVarsComment, parseAddedLegacyVarFindingsFromDiff } from '../check-pr-legacy-css-vars'

describe('check-pr-legacy-css-vars', () => {
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

  it('builds a PR comment body with a marker and summary', () => {
    const body = buildPullRequestLegacyVarsComment([
      {
        file: 'src/renderer/src/example.tsx',
        line: 11,
        variable: '--color-text-1',
        lineText: "const css = 'color: var(--color-text-1);'"
      }
    ])

    expect(body).toContain('<!-- legacy-css-vars-warning -->')
    expect(body).toContain('## Legacy CSS Variables Detected')
    expect(body).toContain('`--color-text-1`')
    expect(body).toContain('This is a migration reminder only and does not block the PR.')
  })
})
