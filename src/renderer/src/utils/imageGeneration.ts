const ASPECT_RATIO_PATTERN = /\b(\d{1,2})\s*[:x×/]\s*(\d{1,2})\b/i
const IMAGE_CONTEXT_PATTERN =
  /\b(image|images|photo|photos|picture|pictures|illustration|illustrations|render|renders|painting|paintings|art|wallpaper|wallpapers|poster|posters|scene|scenes|graphic|graphics|banner|banners|thumbnail|thumbnails)\b/i

const normalizeAspectRatio = (value: string): string | undefined => {
  const normalized = value.trim().replace(/[x×/]/g, ':')

  if (!/^\d{1,2}:\d{1,2}$/.test(normalized)) {
    return undefined
  }

  return normalized
}

export const extractAspectRatioFromPrompt = (prompt: string): string | undefined => {
  if (!/\baspect\s*ratio\b/i.test(prompt) && !IMAGE_CONTEXT_PATTERN.test(prompt)) {
    return undefined
  }

  const match = prompt.match(ASPECT_RATIO_PATTERN)

  if (!match) {
    return undefined
  }

  return normalizeAspectRatio(`${match[1]}:${match[2]}`)
}

export const normalizeImageDimension = (
  imageSize?: string
): { size: `${number}x${number}`; aspectRatio?: never } | { size?: never; aspectRatio: string } => {
  const aspectRatio = imageSize ? normalizeAspectRatio(imageSize) : undefined

  if (aspectRatio) {
    return { aspectRatio }
  }

  return { size: (imageSize || '1024x1024') as `${number}x${number}` }
}
