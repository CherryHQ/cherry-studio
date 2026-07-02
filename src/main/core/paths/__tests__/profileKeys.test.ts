import { describe, expect, it } from 'vitest'

import { isProfilePathKey, PROFILE_PATH_KEYS } from '../profileKeys'

describe('profile path classification', () => {
  it('classifies per-profile keys (Data subtree + DB + per-identity content)', () => {
    for (const key of [
      'app.database.file',
      'app.userdata.data',
      'feature.files.data',
      'feature.knowledgebase.data',
      'feature.agents.claude.root',
      'feature.trace',
      'feature.mcp.oauth',
      'feature.mcp.memory_file',
      'feature.copilot.token_file'
    ] as const) {
      expect(isProfilePathKey(key)).toBe(true)
    }
  })

  it('classifies app-level keys as not per-profile', () => {
    // Notably feature.ocr.tesseract (OCR model data, not user content) and the
    // read-only build artifacts stay app-level.
    for (const key of [
      'cherry.home',
      'app.logs',
      'app.database.migrations',
      'feature.binary.data',
      'feature.provider_registry.data',
      'feature.ocr.tesseract',
      'feature.mcp',
      'sys.home'
    ] as const) {
      expect(isProfilePathKey(key)).toBe(false)
    }
  })

  it('has no duplicate entries', () => {
    expect(new Set(PROFILE_PATH_KEYS).size).toBe(PROFILE_PATH_KEYS.length)
  })
})
