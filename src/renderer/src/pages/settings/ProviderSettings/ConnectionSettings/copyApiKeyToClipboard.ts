export async function copyApiKeyToClipboard(apiKey: string, t: (key: string) => string): Promise<void> {
  try {
    await navigator.clipboard.writeText(apiKey)
    window.toast.success(t('message.copied'))
  } catch {
    window.toast.error(t('common.copy_failed'))
  }
}
