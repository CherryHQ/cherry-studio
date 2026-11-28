import type { RequestPermissionRequest } from '@agentclientprotocol/sdk'

export type AcpPermissionRequest = RequestPermissionRequest
export type AcpPermissionOption = AcpPermissionRequest['options'][number]
export type AcpPermissionOptionDetails = { scope?: 'session'; warning?: string }

export function mapAcpPermissionOptions(
  options: readonly AcpPermissionOption[],
  describe?: (option: AcpPermissionOption) => AcpPermissionOptionDetails
) {
  return options.map((option) => {
    const { kind, name, optionId } = option
    const trimmed = name.trim()
    const details = kind === 'allow_once' || kind === 'allow_always' ? describe?.(option) : undefined
    const base = { optionId, name, ...(details?.warning ? { warning: details.warning } : {}) }
    if (kind === 'allow_once') {
      return {
        ...base,
        decision: 'accept',
        label: /^(?:yes,\s*)?(?:allow|approve)\s+once$/i.test(trimmed)
          ? 'allow_once'
          : /^(?:yes,\s*)?allow$/i.test(trimmed)
            ? 'allow'
            : undefined
      } as const
    }
    if (kind === 'allow_always') {
      const isSessionScoped =
        details?.scope === 'session' || /^(?:yes,\s*)?(?:allow|approve) for (?:this )?session$/i.test(trimmed)
      const isGenericAlways = /^(?:yes,\s*)?(?:always allow|allow always)(?:\s*\(risky\))?$/i.test(trimmed)
      return {
        ...base,
        decision: isSessionScoped ? 'acceptForSession' : 'acceptAlways',
        label: isSessionScoped ? 'allow_session' : isGenericAlways ? 'allow_always' : undefined
      } as const
    }
    if (kind === 'reject_once') {
      return {
        ...base,
        decision: 'decline',
        label: /^(?:no,\s*)?(?:reject|deny|decline)(?:\s+once)?$/i.test(trimmed)
          ? 'deny'
          : /^cancel$/i.test(trimmed)
            ? 'cancel'
            : undefined
      } as const
    }
    return {
      ...base,
      decision: 'decline',
      persistent: true,
      label: /^(?:no,\s*)?(?:always\s+(?:reject|deny)|(?:reject|deny)\s+always|never\s+allow)$/i.test(trimmed)
        ? 'deny_always'
        : undefined
    } as const
  })
}
