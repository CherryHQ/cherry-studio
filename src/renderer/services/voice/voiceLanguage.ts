export function getDefaultVoiceLanguage(interfaceLanguage: string): string {
  return Intl.getCanonicalLocales(interfaceLanguage)[0]
}
