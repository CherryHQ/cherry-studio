const protocols = [
  ['z-image-turbo', 'chat'],
  ['qwen-image-3.0', 'chat'],
  ['qwen-image-3.0-pro', 'chat'],
  ['qwen-image-edit', 'chat'],
  ['qwen-image-edit-plus', 'chat'],
  ['wan2.6-image', 'chat'],
  ['wan2.7-image', 'chat'],
  ['wan2.7-image-pro', 'chat'],
  ['qwen-image', 'text'],
  ['qwen-image-plus', 'text'],
  ['wanx2.1-t2i-turbo', 'text'],
  ['wanx2.1-t2i-plus', 'text'],
  ['wanx2.0-t2i-turbo', 'text'],
  ['wanx-v1', 'reference'],
  ['wan2.5-i2i-preview', 'images'],
  ['qwen-mt-image', 'translation'],
  ['wanx2.1-imageedit', 'edit']
] as const

export function resolveDashScopeImageProtocol(modelId: string) {
  return protocols.find(([id]) => id === modelId)?.[1]
}
