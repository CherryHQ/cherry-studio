import { usePreference } from '@data/hooks/usePreference'
import { createFileRoute } from '@tanstack/react-router'
import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

const FALLBACK_PROVIDER = 'zhipu'

function PaintingsIndexRedirect() {
  const navigate = useNavigate()
  const [defaultPaintingProvider] = usePreference('feature.paintings.default_provider')

  useEffect(() => {
    void navigate({
      to: `/app/paintings/${defaultPaintingProvider || FALLBACK_PROVIDER}`,
      replace: true
    })
  }, [defaultPaintingProvider, navigate])

  return null
}

export const Route = createFileRoute('/app/paintings/')({
  component: PaintingsIndexRedirect
})
