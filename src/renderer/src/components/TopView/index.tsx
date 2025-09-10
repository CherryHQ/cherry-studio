// import { loggerService } from '@logger'
import TopViewMinappContainer from '@renderer/components/MinApp/TopViewMinappContainer'
import { useAppInit } from '@renderer/hooks/useAppInit'
import { useShortcuts } from '@renderer/hooks/useShortcuts'
import { Modal } from 'antd'
import React, { PropsWithChildren, useCallback, useEffect, useRef, useState } from 'react'

import { Box } from '../Layout'
import { getToastUtilities } from './toast'

let onPop = () => {}
let onShow = ({ element, id }: { element: React.FC | React.ReactNode; id: string }) => {
  element
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

  const [modal, modalContextHolder] = Modal.useModal()
  const { shortcuts } = useShortcuts()
  const enableQuitFullScreen = shortcuts.find((item) => item.key === 'exit_fullscreen')?.enabled

  useAppInit()

  useEffect(() => {
    window.modal = modal
    window.toast = getToastUtilities()
  }, [modal])

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
      <Box flex={1} position="absolute" w="100%" h="100%" className="topview-fullscreen-container">
        <Box position="absolute" w="100%" h="100%" onClick={onPop} />
        {children}
      </Box>
    )
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // logger.debug('keydown', e)
      if (!enableQuitFullScreen) return

      if (e.key === 'Escape' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        window.api.setFullScreen(false)
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
      {modalContextHolder}
      <TopViewMinappContainer />
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
