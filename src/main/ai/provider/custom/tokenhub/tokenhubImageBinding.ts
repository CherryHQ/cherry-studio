const protocols = [
  ['/v1/wand/hunyuan-image/v3-generation', 'hunyuan'],
  ['/v1/wand/si-image/generation', 'seedream'],
  ['/v1/wand/vidu-image/generation', 'vidu']
] as const

export function resolveTokenhubImageProtocol(endpoint: string) {
  return protocols.find(([path]) => path === endpoint)?.[1]
}
