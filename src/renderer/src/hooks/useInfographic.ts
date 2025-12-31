import { useTheme } from '@renderer/context/ThemeProvider'
import { ThemeMode } from '@renderer/types'
import { useEffect, useState } from 'react'

let infographicModule: any = null
let infographicLoading = false

let infographicLoadPromise: Promise<any> | null = null

const loadInfographicModule = async () => {
  if (infographicModule) return infographicModule
  if (infographicLoading && infographicLoadPromise) return infographicLoadPromise

  infographicLoading = true
  infographicLoadPromise = import('@antv/infographic')
    .then((module) => {
      infographicModule = module
      infographicLoading = false
      return infographicModule
    })
    .catch((error) => {
      infographicLoading = false
      throw error
    })

  return infographicLoadPromise
}

export const useInfographic = () => {
  const { theme } = useTheme()
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [forceRenderKey, setForceRenderKey] = useState(0)

  useEffect(() => {
    let mounted = true

    const initialize = async () => {
      try {
        setIsLoading(true)
        await loadInfographicModule()

        if (!mounted) return

        setForceRenderKey((prev) => prev + 1)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initialize Infographic')
      } finally {
        if (mounted) {
          setIsLoading(false)
        }
      }
    }

    initialize()

    return () => {
      mounted = false
    }
  }, [theme])

  return {
    Infographic: infographicModule?.Infographic,
    isLoading,
    error,
    forceRenderKey,
    theme: theme === ThemeMode.dark ? 'dark' : 'light'
  }
}
