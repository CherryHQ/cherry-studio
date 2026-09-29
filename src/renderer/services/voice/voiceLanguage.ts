export function getDefaultVoiceLanguage(interfaceLanguage: string): 'zh-CN' | 'en-US' {
  return interfaceLanguage.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
}
