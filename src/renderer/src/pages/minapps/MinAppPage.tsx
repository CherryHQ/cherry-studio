import { loggerService } from '@logger'
import { DEFAULT_MIN_APPS } from '@renderer/config/minapps'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useNavbarPosition } from '@renderer/hooks/useSettings'
import TabsService from '@renderer/services/TabsService'
import { FC, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import styled from 'styled-components'

import MinAppFullPageView from './components/MinAppFullPageView'

const logger = loggerService.withContext('MinAppPage')

const MinAppPage: FC = () => {
  const { appId } = useParams<{ appId: string }>()
  const { isTopNavbar } = useNavbarPosition()
  const { openMinappKeepAlive, minAppsCache } = useMinappPopup()
  const { minapps } = useMinapps()
  const { openedKeepAliveMinapps } = useRuntime()
  const navigate = useNavigate()

  // Track if we've handled the initial redirect for this app
  const [hasHandledRedirect, setHasHandledRedirect] = useState<boolean>(false)

  // Initialize TabsService with cache reference
  useEffect(() => {
    if (minAppsCache) {
      TabsService.setMinAppsCache(minAppsCache)
    }
  }, [minAppsCache])

  // Reset redirect state when app changes or navbar position changes
  useEffect(() => {
    setHasHandledRedirect(false)
  }, [appId, isTopNavbar])

  // Find the app from all available apps
  const app = useMemo(() => {
    if (!appId) return null
    return [...DEFAULT_MIN_APPS, ...minapps].find((app) => app.id === appId)
  }, [appId, minapps])

  useEffect(() => {
    // If app not found, redirect to apps list
    if (!app) {
      navigate('/apps')
      return
    }

    // For sidebar navigation, redirect to apps list and open popup
    // Only check once and only if we haven't already redirected
    if (!isTopNavbar && !hasHandledRedirect) {
      setHasHandledRedirect(true)
      navigate('/apps')
      // Open popup after navigation
      setTimeout(() => {
        openMinappKeepAlive(app)
      }, 100)
      return
    }

    // For top navbar mode, integrate with cache system
    if (isTopNavbar) {
      // Check if app is already in the keep-alive cache
      const isAlreadyInCache = openedKeepAliveMinapps.some((cachedApp) => cachedApp.id === app.id)

      if (!isAlreadyInCache) {
        logger.debug(`Adding app ${app.id} to keep-alive cache via openMinappKeepAlive`)
        // Add to cache without showing popup (for tab mode)
        openMinappKeepAlive(app)
      } else {
        logger.debug(`App ${app.id} already in keep-alive cache`)
      }
    }
  }, [app, navigate, openMinappKeepAlive, openedKeepAliveMinapps, isTopNavbar, hasHandledRedirect])

  // Don't render anything if app not found or not in top navbar mode
  if (!app || !isTopNavbar) {
    return null
  }

  return (
    <Container>
      <MinAppFullPageView app={app} />
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
`

export default MinAppPage
