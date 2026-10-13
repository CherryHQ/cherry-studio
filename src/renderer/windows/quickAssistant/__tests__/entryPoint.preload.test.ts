import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const entryPointSource = readFileSync(join(process.cwd(), 'src/renderer/windows/quickAssistant/entryPoint.tsx'), 'utf8')

describe('quick assistant entryPoint bootstrap', () => {
  // useTemporaryTopic reads `maxMessages` through a ref at lease time and the lease effect only
  // depends on [enabled, assistantId, epoch], so the first topic ignores the saved cap unless the
  // preference is warm before the first frame (cherry-review finding on PR #21358).
  it('preloads the context cap preference before the first frame', () => {
    expect(entryPointSource).toContain("'feature.quick_assistant.context_max_messages'")
  })
})
