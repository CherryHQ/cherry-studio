import { loggerService } from '@logger'
import { Navbar, NavbarCenter, NavbarRight } from '@renderer/components/app/Navbar'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { useAllProviders } from '@renderer/hooks/useProvider'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { useAppDispatch } from '@renderer/store'
import { setGenerating } from '@renderer/store/runtime'
import type { Painting } from '@renderer/types'
import { uuid } from '@renderer/utils'
import type { FC, ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import Artboard from './components/Artboard'
import PaintingsList from './components/PaintingsList'
import ProviderSelect from './components/ProviderSelect'

export interface PaintingProviderPageProps {
  /** Provider ID for this painting page */
  providerId: string
  /** Available provider options for the selector */
  Options: string[]
  /** Default painting state */
  defaultPainting: Painting
  /** Logger context name */
  loggerContext: string
  /** Custom settings panel to render */
  settingsPanel: ReactNode
  /** Custom artboard content (model select, etc.) */
  artboardContent?: ReactNode
  /** Function to generate images */
  onGenerate: (painting: Painting) => Promise<void>
  /** Function to abort generation */
  onAbort?: () => void
}

const logger = loggerService.withContext('PaintingProviderPage')

export const PaintingProviderPage: FC<PaintingProviderPageProps> = ({
  providerId,
  Options,
  defaultPainting,
  loggerContext,
  settingsPanel,
  artboardContent,
  onGenerate,
  onAbort
}) => {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const { paintings, addPainting, removePainting, updatePainting } = usePaintings()
  const { generating } = useRuntime()
  const providers = useAllProviders()
  const { paintingActionMode } = useSettings()

  const [painting, setPainting] = useState<Painting>(defaultPainting)
  const [isLoading, setIsLoading] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const [fileMap, setFileMap] = useState<Record<string, File>>({})
  const [currentImageIndex, setCurrentImageIndex] = useState(0)

  const providerLogger = loggerService.withContext(loggerContext)

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
      await onGenerate(painting)
    } catch (error) {
      providerLogger.error('Generation failed:', error as Error)
    } finally {
      setIsLoading(false)
      dispatch(setGenerating(false))
    }
  }, [generating, painting, onGenerate, dispatch, providerLogger])

  const handleAbort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setIsLoading(false)
    dispatch(setGenerating(false))
    onAbort?.()
  }, [dispatch, onAbort])

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

  return (
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('paintings.title')}</NavbarCenter>
        <NavbarRight>
          <ProviderSelect
            value={providerId}
            options={Options}
            onChange={(value) => navigate(`/paintings/${value}`)}
          />
        </NavbarRight>
      </Navbar>
      <ContentContainer>
        <SettingsPanel>{settingsPanel}</SettingsPanel>
        <ArtboardContainer>
          <Artboard
            painting={painting}
            isLoading={isLoading}
            onGenerate={handleGenerate}
            onAbort={handleAbort}
            onSave={handleSave}
            onDelete={handleDelete}>
            {artboardContent}
          </Artboard>
        </ArtboardContainer>
        <PaintingsList
          paintings={paintings.filter((p) => p.provider === providerId)}
          currentPainting={painting}
          onSelect={(p) => setPainting(p)}
          onDelete={handleDelete}
        />
      </ContentContainer>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  overflow: hidden;
`

const SettingsPanel = styled.div`
  width: 300px;
  overflow-y: auto;
  padding: 16px;
  border-right: 1px solid var(--color-border);
`

const ArtboardContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`
