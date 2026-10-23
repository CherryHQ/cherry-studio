import { stripBedrockVendorPrefix, stripBedrockRevision } from './normalize'

/** A matching view only: preserves sizes, thinking/search variants and local-runner tags. */
export function modelMatchId(rawId: string): string {
  let id = rawId.toLowerCase().split('/').at(-1) ?? ''
  if (rawId.toLowerCase().startsWith('accounts/fireworks/models/')) id = id.replace(/(\d)p(?=\d)/g, '$1.')
  const bare = stripBedrockVendorPrefix(id)
  id = bare === id ? id : stripBedrockRevision(bare)
  return id.replace(/(?::free|:cloud|\(free\))$/, '').replace(/(\d)\.(?=\d)/g, '$1-')
}
