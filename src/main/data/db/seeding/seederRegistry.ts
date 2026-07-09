import type { ISeeder } from '../types'
import { CherryAiDefaultModelSeeder } from './seeders/cherryaiDefaultModelSeeder'
import { CherryAssistantSeeder } from './seeders/cherryAssistantSeeder'
import { DefaultAssistantSeeder } from './seeders/defaultAssistantSeeder'
import { MiniAppSeeder } from './seeders/miniAppSeeder'
import { PreferenceSeeder } from './seeders/preferenceSeeder'
import { PresetProviderSeeder } from './seeders/presetProviderSeeder'
import { TranslateLanguageSeeder } from './seeders/translateLanguageSeeder'

/**
 * All seeders in execution order.
 *
 * Keep CherryAiDefaultModelSeeder before CherryAssistantSeeder and DefaultAssistantSeeder:
 * both default agents may reference the CherryAI default model (FK to user_model),
 * so the model row must exist first.
 *
 * To add a new seeder: create an ISeeder class, add it to this array.
 * No changes to DbService needed.
 */
export const seeders: ISeeder[] = [
  new CherryAiDefaultModelSeeder(),
  new CherryAssistantSeeder(),
  new DefaultAssistantSeeder(),
  new PreferenceSeeder(),
  new TranslateLanguageSeeder(),
  new PresetProviderSeeder(),
  new MiniAppSeeder()
]
