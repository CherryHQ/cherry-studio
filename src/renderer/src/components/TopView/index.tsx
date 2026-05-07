// import { loggerService } from '@logger'
import { Box } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import AppModalProvider from '@renderer/components/AppModal'
import { useAppInit } from '@renderer/hooks/useAppInit'
import type { PropsWithChildren } from 'react'
import React, { useCallback, useEffect, useRef, useState } from 'react'

import { getToastUtilities, ToastViewport } from './toast'

let onPop = () => {}
let onShow = ({ element, id }: { element: React.FC | React.ReactNode; id: string }) => {
  void element
  id
}
let onHide = (id: string) => {
  id
}
let onHideAll = () => {}

interface Props {
  children?: React.ReactNode
}

type ElementItem = {
  id: string
  element: React.FC | React.ReactNode
}

// const logger = loggerService.withContext('TopView')

const TopViewContainer: React.FC<Props> = ({ children }) => {
  const [elements, setElements] = useState<ElementItem[]>([])
  const elementsRef = useRef<ElementItem[]>([])
  elementsRef.current = elements

  const [exitFullscreenPref] = usePreference('shortcut.general.exit_fullscreen')
  const enableQuitFullScreen = exitFullscreenPref?.enabled !== false

  useAppInit()

  useEffect(() => {
    window.toast = getToastUtilities()
  }, [])

  onPop = () => {
    const views = [...elementsRef.current]
    views.pop()
    elementsRef.current = views
    setElements(elementsRef.current)
  }

  onShow = ({ element, id }: ElementItem) => {
    if (!elementsRef.current.find((el) => el.id === id)) {
      elementsRef.current = elementsRef.current.concat([{ element, id }])
      setElements(elementsRef.current)
    }
  }

  onHide = (id: string) => {
    elementsRef.current = elementsRef.current.filter((el) => el.id !== id)
    setElements(elementsRef.current)
  }

  onHideAll = () => {
    setElements([])
    elementsRef.current = []
  }

  const FullScreenContainer: React.FC<PropsWithChildren> = useCallback(({ children }) => {
    return (
      <Box className="topview-fullscreen-container absolute h-full w-full flex-1">
        <Box className="absolute h-full w-full" onClick={onPop} />
        {children}
      </Box>
    )
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // logger.debug('keydown', e)
      if (!enableQuitFullScreen) return

      if (e.key === 'Escape' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        void window.api.windowManager.setFullScreen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  })

  return (
    <>
      {children}
      <ToastViewport />
      <AppModalProvider
        onReady={(modal) => {
          window.modal = modal
        }}
      />
      {elements.map(({ element: Element, id }) => (
        <FullScreenContainer key={`TOPVIEW_${id}`}>
          {typeof Element === 'function' ? <Element /> : Element}
        </FullScreenContainer>
      ))}
    </>
  )
}

export const TopView = {
  show: (element: React.FC | React.ReactNode, id: string) => onShow({ element, id }),
  hide: (id: string) => onHide(id),
  clear: () => onHideAll(),
  pop: onPop
}

export default TopViewContainer
