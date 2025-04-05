import HistoryPage from '@renderer/pages/history/HistoryPage'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { Modal } from 'antd'
import { useEffect, useState } from 'react'

import { TopView } from '../TopView'

interface Props {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)

  const onOk = () => {
    setOpen(false)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  useEffect(() => {
    const focusSearchInput = () => {
      if (open) {
        // 通过事件系统广播焦点恢复事件
        EventEmitter.emit(EVENT_NAMES.FOCUS_SEARCH_INPUT)
      }
    }

    // 添加窗口聚焦事件监听器
    const handleWindowFocus = () => {
      focusSearchInput()
    }

    window.addEventListener('focus', handleWindowFocus)

    return () => {
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [open])

  SearchPopup.hide = onCancel

  return (
    <Modal
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      title={null}
      width="920px"
      transitionName="ant-move-down"
      styles={{
        content: {
          padding: 0,
          border: `1px solid var(--color-frame-border)`
        },
        body: { height: '85vh' }
      }}
      centered
      footer={null}>
      <HistoryPage />
    </Modal>
  )
}

export default class SearchPopup {
  static topviewId = 0
  static hide() {
    TopView.hide('SearchPopup')
  }
  static show() {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          resolve={(v) => {
            resolve(v)
            TopView.hide('SearchPopup')
          }}
        />,
        'SearchPopup'
      )
    })
  }
}
