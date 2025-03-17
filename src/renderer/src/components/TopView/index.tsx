import { useAppInit } from '@renderer/hooks/useAppInit'
import { message, Modal } from 'antd'
import React, { PropsWithChildren, useCallback, useEffect, useRef, useState } from 'react'

import { Box } from '../Layout'

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

const TopViewContainer: React.FC<Props> = ({ children }) => {
  const [elements, setElements] = useState<ElementItem[]>([])
  const elementsRef = useRef<ElementItem[]>([])
  elementsRef.current = elements

  const [messageApi, messageContextHolder] = message.useMessage()
  const [modal, modalContextHolder] = Modal.useModal()

  useAppInit()

  useEffect(() => {
    window.message = messageApi
    window.modal = modal
  }, [messageApi, modal])

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
      <Box flex={1} position="absolute" w="100%" h="100%">
        <Box position="absolute" w="100%" h="100%" onClick={onPop} />
        {children}
      </Box>
    )
  }, [])

  return (
    <>
      {children}
      {messageContextHolder}
      {modalContextHolder}
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
