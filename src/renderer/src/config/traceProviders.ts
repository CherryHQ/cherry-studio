import LangfuseLogo from '@renderer/assets/images/trace/langfuse.svg'

export function getTraceProviderLogo(id: string) {
  switch (id.toLowerCase()) {
    case 'langfuse':
      return LangfuseLogo
    default:
      return undefined
  }
}

export const TRACE_PROVIDER_CONFIG = {
  langfuse: {
    name: 'Langfuse',
    websites: {
      official: 'https://langfuse.com'
    }
  }
}
