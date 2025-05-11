import MarkdownEditor from '@renderer/components/MarkdownEditor'
import { TopView } from '@renderer/components/TopView'
import { useProvider } from '@renderer/hooks/useProvider'
import { Provider } from '@renderer/types'
import { Modal } from 'antd'
import { FC, useState } from 'react'
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

  const handleSave = () => {
    updateProvider({
      ...provider,
      notes
    })
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
      onOk={handleSave}
      onCancel={onCancel}
      afterClose={onClose}
      width={800}
      transitionName="animation-move-down"
      centered>
      <EditorContainer>
        <MarkdownEditor
          value={notes}
          onChange={setNotes}
          placeholder={t('settings.provider.notes.placeholder')}
          height="400px"
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
