import { useEffect } from 'react'

import { usePreference } from '@data/hooks/usePreference'

const BACKGROUND_ELEMENT_ID = 'user-defined-background-image'
const BACKGROUND_ATTRIBUTE = 'data-custom-background'
const ALLOWED_URL_PATTERN = /^(https?:|file:|data:image\/)/i

export type BackgroundImageOptions = {
  image: string | undefined
  opacity: number
  blur: number
  size: 'cover' | 'contain' | 'auto'
}

export function isSupportedBackgroundUrl(url: string): boolean {
  return ALLOWED_URL_PATTERN.test(url) && !/[\r\n]/.test(url)
}

/**
 * Render a fixed layer behind the app UI and make the translucent-capable surface tokens
 * (`--background` / `--sidebar` / `--card`) semi-transparent so the image shows through.
 * Unsupported URL schemes and an empty image remove the layer entirely.
 */
export function useBackgroundImageInjection({ image, opacity, blur, size }: BackgroundImageOptions): void {
  useEffect(() => {
    document.getElementById(BACKGROUND_ELEMENT_ID)?.remove()
    document.documentElement.removeAttribute(BACKGROUND_ATTRIBUTE)

    if (!image || !isSupportedBackgroundUrl(image)) return

    const element = document.createElement('div')
    element.id = BACKGROUND_ELEMENT_ID
    element.setAttribute('aria-hidden', 'true')
    Object.assign(element.style, {
      position: 'fixed',
      inset: `${-blur * 2}px`,
      zIndex: '-1',
      pointerEvents: 'none',
      backgroundImage: `url(${JSON.stringify(image)})`,
      backgroundSize: size,
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      opacity: String(Math.min(Math.max(opacity, 0), 100) / 100),
      filter: blur > 0 ? `blur(${blur}px)` : ''
    })
    document.body.appendChild(element)
    document.documentElement.setAttribute(BACKGROUND_ATTRIBUTE, 'true')

    return () => {
      element.remove()
      document.documentElement.removeAttribute(BACKGROUND_ATTRIBUTE)
    }
  }, [image, opacity, blur, size])
}

/** Apply the user's `ui.background.*` preferences in every full-chrome window. */
export function useBackgroundImage(): void {
  const [image] = usePreference('ui.background.image')
  const [opacity] = usePreference('ui.background.opacity')
  const [blur] = usePreference('ui.background.blur')
  const [size] = usePreference('ui.background.size')
  useBackgroundImageInjection({ image, opacity, blur, size })
}
