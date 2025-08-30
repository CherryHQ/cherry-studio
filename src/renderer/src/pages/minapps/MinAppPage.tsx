import { DEFAULT_MIN_APPS } from '@renderer/config/minapps'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { useNavbarPosition } from '@renderer/hooks/useSettings'
import { FC, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import styled from 'styled-components'

import MinAppFullPageView from './components/MinAppFullPageView'

const MinAppPage: FC = () => {
  const { appId } = useParams<{ appId: string }>()
  const { isTopNavbar } = useNavbarPosition()
  const { openMinappKeepAlive } = useMinappPopup()
  const { minapps } = useMinapps()
  const navigate = useNavigate()

  // Find the app from all available apps
  const app = [...DEFAULT_MIN_APPS, ...minapps].find((app) => app.id === appId)

  useEffect(() => {
    // If app not found, redirect to apps list
    if (!app) {
      navigate('/apps')
      return
    }

    // For sidebar navigation, redirect to apps list and open popup
    if (!isTopNavbar) {
      navigate('/apps')
      // Open popup after navigation
      setTimeout(() => {
        openMinappKeepAlive(app)
      }, 100)
      return
    }
  }, [app, isTopNavbar, navigate, openMinappKeepAlive])

  // Don't render anything if app not found or redirecting
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
