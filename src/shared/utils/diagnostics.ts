export const DIAGNOSTIC_FEEDBACK_FORM_URL = 'https://mcnnox2fhjfq.feishu.cn/share/base/form/shrcnufZiSDrvRPIzSKeqcbBbub'

export const DIAGNOSTIC_DESCRIPTION_MAX_BYTES = 4096

export function normalizeDiagnosticDescription(value: string): string {
  return value.replace(/\r\n|\r|\n/g, '\r\n')
}

export function diagnosticDescriptionByteLength(value: string): number {
  return new TextEncoder().encode(normalizeDiagnosticDescription(value)).byteLength
}
