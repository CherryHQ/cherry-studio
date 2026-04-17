import { LanguagesEnum } from '@renderer/config/translate'
import { translateText } from '@renderer/services/TranslateService'

export async function translatePaintingPrompt(prompt: string): Promise<string> {
  return translateText(prompt, LanguagesEnum.enUS)
}
