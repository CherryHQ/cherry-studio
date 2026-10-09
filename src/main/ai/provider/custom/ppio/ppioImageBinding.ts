const protocols = [
  ['/v3/async/jimeng-txt2img-v3.1', 'jimeng'],
  ['/v3/async/jimeng-txt2img-v3.0', 'jimeng'],
  ['/v3/async/hunyuan-image-3', 'hunyuan'],
  ['/v3/async/qwen-image-txt2img', 'qwen-generate'],
  ['/v3/async/qwen-image-edit', 'qwen-edit'],
  ['/v3/async/qwen-image-edit-2509', 'qwen-edit'],
  ['/v3/async/glm-image', 'glm'],
  ['/v3/async/z-image-turbo', 'z-image'],
  ['/v3/async/z-image-turbo-lora', 'z-image-lora'],
  ['/v3/seedream-4.0', 'seedream-images'],
  ['/v3/seedream-4.5', 'seedream-image'],
  ['/v3/seedream-5.0-lite', 'seedream-image']
] as const

export function resolvePpioImageProtocol(endpoint: string) {
  return protocols.find(([path]) => path === endpoint)?.[1]
}
