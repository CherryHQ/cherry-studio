import carousel1 from '@renderer/assets/images/guide/Carousel_1.png'
import carousel1Dark from '@renderer/assets/images/guide/Carousel_1_dark.png'
import carousel2 from '@renderer/assets/images/guide/Carousel_2.png'
import carousel2Dark from '@renderer/assets/images/guide/Carousel_2_dark.png'
import carousel3 from '@renderer/assets/images/guide/Carousel_3.png'
import carousel3Dark from '@renderer/assets/images/guide/Carousel_3_dark.png'
import { useTheme } from '@renderer/context/ThemeProvider'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  CarouselDot,
  CarouselDots,
  FeatureContent,
  FeatureDescription,
  FeatureImage,
  FeatureTitle,
  gradients,
  RightPanel
} from './styles'

interface FeatureSlide {
  titleKey: string
  descriptionKey: string
  gradient: string
  image: string
  imageDark: string
}

const slides: FeatureSlide[] = [
  {
    titleKey: 'userGuide.guidePage.carousel.assistants.title',
    descriptionKey: 'userGuide.guidePage.carousel.assistants.description',
    gradient: gradients.assistants,
    image: carousel1,
    imageDark: carousel1Dark
  },
  {
    titleKey: 'userGuide.guidePage.carousel.paintings.title',
    descriptionKey: 'userGuide.guidePage.carousel.paintings.description',
    gradient: gradients.paintings,
    image: carousel2,
    imageDark: carousel2Dark
  },
  {
    titleKey: 'userGuide.guidePage.carousel.models.title',
    descriptionKey: 'userGuide.guidePage.carousel.models.description',
    gradient: gradients.models,
    image: carousel3,
    imageDark: carousel3Dark
  }
]

const FeatureCarousel: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [activeIndex, setActiveIndex] = useState(0)
  const isDark = theme === 'dark'

  const nextSlide = useCallback(() => {
    setActiveIndex((prev) => (prev + 1) % slides.length)
  }, [])

  useEffect(() => {
    const interval = setInterval(nextSlide, 5000)
    return () => clearInterval(interval)
  }, [nextSlide])

  const currentSlide = slides[activeIndex]

  return (
    <RightPanel $gradient={currentSlide.gradient}>
      <FeatureContent>
        <FeatureTitle>{t(currentSlide.titleKey)}</FeatureTitle>
        <FeatureDescription>{t(currentSlide.descriptionKey)}</FeatureDescription>
        <FeatureImage>
          <img src={isDark ? currentSlide.imageDark : currentSlide.image} alt="" />
        </FeatureImage>
      </FeatureContent>
      <CarouselDots>
        {slides.map((_, index) => (
          <CarouselDot key={index} $active={index === activeIndex} onClick={() => setActiveIndex(index)} />
        ))}
      </CarouselDots>
    </RightPanel>
  )
}

export default FeatureCarousel
