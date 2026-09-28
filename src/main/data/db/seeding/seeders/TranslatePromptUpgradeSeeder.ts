import { and, eq } from 'drizzle-orm'

import { preferenceTable } from '@data/db/schemas/preference'
import { LEGACY_TRANSLATE_PROMPT, TRANSLATE_PROMPT } from '@shared/ai/prompts'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

const TRANSLATE_PROMPT_UPGRADE = {
  scope: 'default',
  key: 'feature.translate.model_prompt',
  legacyValue: LEGACY_TRANSLATE_PROMPT,
  nextValue: TRANSLATE_PROMPT
} as const

export class TranslatePromptUpgradeSeeder implements ISeeder {
  readonly name = 'translatePromptUpgrade'
  readonly description = 'Preserve Markdown and diagram syntax in the built-in translation prompt'
  readonly version = hashObject(TRANSLATE_PROMPT_UPGRADE)

  run(db: DbType): void {
    const storedPrompt = db
      .select({ value: preferenceTable.value })
      .from(preferenceTable)
      .where(
        and(
          eq(preferenceTable.scope, TRANSLATE_PROMPT_UPGRADE.scope),
          eq(preferenceTable.key, TRANSLATE_PROMPT_UPGRADE.key)
        )
      )
      .get()

    if (storedPrompt?.value !== TRANSLATE_PROMPT_UPGRADE.legacyValue) return

    db.update(preferenceTable)
      .set({ value: TRANSLATE_PROMPT_UPGRADE.nextValue })
      .where(
        and(
          eq(preferenceTable.scope, TRANSLATE_PROMPT_UPGRADE.scope),
          eq(preferenceTable.key, TRANSLATE_PROMPT_UPGRADE.key)
        )
      )
      .run()
  }
}
