import RichTextEditor from '@renderer/components/RichTextEditor'
import { TopView } from '@renderer/components/TopView'
import { useProvider } from '@renderer/hooks/useProvider'
import { Provider } from '@renderer/types'
import { Modal } from 'antd'
import { FC, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface ShowParams {
  provider: Provider
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: FC<Props> = ({ provider: _provider, resolve }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const { provider, updateProvider } = useProvider(_provider.id)
  const [notes, setNotes] = useState<string>(provider.notes || '')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  const handleNotesChange = useCallback((value: string) => {
    setNotes(value)
    setHasUnsavedChanges(true)
  }, [])

  const handleSave = useCallback(
    (html: string) => {
      // 这里接收的是HTML格式
      setNotes(html)
      setHasUnsavedChanges(false)
      // 立即保存到provider
      updateProvider({
        ...provider,
        notes: html
      })
    },
    [provider, updateProvider]
  )

  const handleOk = () => {
    // 如果有未保存的更改，在关闭前保存
    if (hasUnsavedChanges) {
      updateProvider({
        ...provider,
        notes
      })
    }
    setOpen(false)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  return (
    <Modal
      title={t('settings.provider.notes.title')}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      afterClose={onClose}
      width={800}
      transitionName="animation-move-down"
      centered
      okText={t('common.confirm')}>
      <EditorContainer>
        <RichTextEditor
          value={notes}
          onChange={handleNotesChange}
          onSave={handleSave}
          height="400px"
          placeholder={t('settings.provider.notes.placeholder')}
          showPreview={true}
        />
      </EditorContainer>
    </Modal>
  )
}

const EditorContainer = styled.div`
  margin-top: 16px;
  height: 400px;
`

export default class ModelNotesPopup {
  static hide() {
    TopView.hide('ModelNotesPopup')
  }
  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            this.hide()
          }}
        />,
        'ModelNotesPopup'
      )
    })
  }
}
