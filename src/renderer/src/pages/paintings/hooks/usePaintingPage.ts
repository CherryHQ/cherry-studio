import { loggerService } from '@logger'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { useAppDispatch } from '@renderer/store'
import { setGenerating } from '@renderer/store/runtime'
import type { Painting } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export interface UsePaintingPageOptions {
  /** Provider ID for this painting page */
  providerId: string
  /** Default painting state */
  defaultPainting: Painting
  /** Logger context name */
  loggerContext: string
}

export interface UsePaintingPageReturn {
  /** Current painting state */
  painting: Painting
  /** Set painting state */
  setPainting: (painting: Painting) => void
  /** Whether generation is in progress */
  isLoading: boolean
  /** Abort controller for generation */
  abortControllerRef: React.MutableRefObject<AbortController | null>
  /** File map for uploaded files */
  fileMap: Record<string, File>
  /** Set file map */
  setFileMap: React.Dispatch<React.SetStateAction<Record<string, File>>>
  /** Current image index */
  currentImageIndex: number
  /** Set current image index */
  setCurrentImageIndex: (index: number) => void
  /** All paintings for this provider */
  providerPaintings: Painting[]
  /** Whether global generation is in progress */
  generating: boolean
  /** Handle generation start */
  handleGenerate: () => Promise<void>
  /** Handle generation abort */
  handleAbort: () => void
  /** Handle painting save */
  handleSave: () => Promise<void>
  /** Handle painting delete */
  handleDelete: () => Promise<void>
  /** Logger instance */
  logger: ReturnType<typeof loggerService.withContext>
}

export function usePaintingPage({
  providerId,
  defaultPainting,
  loggerContext
}: UsePaintingPageOptions): UsePaintingPageReturn {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const { paintings, addPainting, removePainting, updatePainting } = usePaintings()
  const { generating } = useRuntime()
  const { paintingActionMode } = useSettings()

  const [painting, setPainting] = useState<Painting>(defaultPainting)
  const [isLoading, setIsLoading] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const [fileMap, setFileMap] = useState<Record<string, File>>({})
  const [currentImageIndex, setCurrentImageIndex] = useState(0)

  const logger = loggerService.withContext(loggerContext)

  // Update painting when defaultPainting changes
  useEffect(() => {
    setPainting(defaultPainting)
  }, [defaultPainting])

  // Load painting from URL if present
  useEffect(() => {
    const loadPainting = async () => {
      const pathParts = pathname.split('/')
      const paintingId = pathParts[pathParts.length - 1]
      if (paintingId && paintingId !== providerId) {
        const existingPainting = paintings.find((p) => p.id === paintingId)
        if (existingPainting) {
          setPainting(existingPainting)
        }
      }
    }
    void loadPainting()
  }, [pathname, paintings, providerId])

  const handleGenerate = useCallback(async () => {
    if (generating) return

    setIsLoading(true)
    dispatch(setGenerating(true))

    try {
      // This will be overridden by the component
      await Promise.resolve()
    } catch (error) {
      logger.error('Generation failed:', error as Error)
    } finally {
      setIsLoading(false)
      dispatch(setGenerating(false))
    }
  }, [generating, dispatch, logger])

  const handleAbort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setIsLoading(false)
    dispatch(setGenerating(false))
  }, [dispatch])

  const handleSave = useCallback(async () => {
    const newPainting = {
      ...painting,
      id: painting.id || uuid(),
      provider: providerId,
      createdAt: new Date().toISOString()
    }

    if (painting.id) {
      await updatePainting(newPainting)
    } else {
      await addPainting(newPainting)
    }

    navigate(`/paintings/${providerId}/${newPainting.id}`)
  }, [painting, providerId, updatePainting, addPainting, navigate])

  const handleDelete = useCallback(async () => {
    if (painting.id) {
      await removePainting(painting.id)
      setPainting(defaultPainting)
      navigate(`/paintings/${providerId}`)
    }
  }, [painting.id, removePainting, defaultPainting, navigate, providerId])

  const providerPaintings = paintings.filter((p) => p.provider === providerId)

  return {
    painting,
    setPainting,
    isLoading,
    abortControllerRef,
    fileMap,
    setFileMap,
    currentImageIndex,
    setCurrentImageIndex,
    providerPaintings,
    generating,
    handleGenerate,
    handleAbort,
    handleSave,
    handleDelete,
    logger
  }
}
