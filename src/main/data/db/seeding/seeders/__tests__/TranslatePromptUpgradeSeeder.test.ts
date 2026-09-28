import { setupTestDatabase } from '@test-helpers/db'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { preferenceTable } from '@data/db/schemas/preference'
import { seeders } from '@data/db/seeding/seederRegistry'
import { SeedRunner } from '@data/db/seeding/SeedRunner'
import { LEGACY_TRANSLATE_PROMPT, TRANSLATE_PROMPT } from '@shared/ai/prompts'

const TRANSLATE_PROMPT_KEY = 'feature.translate.model_prompt'
const TRANSLATE_PROMPT_SEEDERS = seeders.filter(
  ({ name }) => name === 'translatePromptUpgrade' || name === 'preference'
)

describe('TranslatePromptUpgradeSeeder', () => {
  const dbh = setupTestDatabase()

  const readPrompt = () =>
    dbh.db
      .select({ value: preferenceTable.value })
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, TRANSLATE_PROMPT_KEY)))
      .get()?.value

  const writePrompt = (value: string) => {
    dbh.db.insert(preferenceTable).values({ scope: 'default', key: TRANSLATE_PROMPT_KEY, value }).run()
  }

  it('seeds the format-preserving prompt for a new installation', () => {
    new SeedRunner(dbh.db).runAll(TRANSLATE_PROMPT_SEEDERS)

    expect(readPrompt()).toBe(TRANSLATE_PROMPT)
  })

  it('upgrades the previous built-in prompt for an existing installation', () => {
    writePrompt(LEGACY_TRANSLATE_PROMPT)

    new SeedRunner(dbh.db).runAll(TRANSLATE_PROMPT_SEEDERS)

    expect(readPrompt()).toBe(TRANSLATE_PROMPT)
  })

  it('preserves a custom translation prompt', () => {
    const customPrompt = 'Translate {{text}} into {{target_language}} in my preferred style.'
    writePrompt(customPrompt)

    new SeedRunner(dbh.db).runAll(TRANSLATE_PROMPT_SEEDERS)

    expect(readPrompt()).toBe(customPrompt)
  })
})
