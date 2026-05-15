import codeHeroIllustration from '@renderer/assets/images/code/code-hero-illustration.webp'
import type { SVGProps } from 'react'

export function CodeHeroIllustrationIcon(props: SVGProps<SVGSVGElement>) {
  const { width = 96, height = width, ...svgProps } = props

  return (
    <svg width={width} height={height} viewBox="0 0 256 256" role="img" {...svgProps}>
      <image href={codeHeroIllustration} width="256" height="256" preserveAspectRatio="xMidYMid meet" />
    </svg>
  )
}
