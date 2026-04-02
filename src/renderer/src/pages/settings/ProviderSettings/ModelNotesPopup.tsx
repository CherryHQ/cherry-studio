import MarkdownEditor from '@renderer/components/MarkdownEditor'
import { TopView } from '@renderer/components/TopView'
import { dataApiService } from '@renderer/data/DataApiService'
import { useInvalidateCache, useQuery } from '@renderer/data/hooks/useDataApi'
import type { Provider } from '@shared/data/types/provider'
import { Modal } from 'antd'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface ShowParams {
  providerId: string
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: FC<Props> = ({ providerId, resolve }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const { data: provider } = useQuery(`/providers/${providerId}` as any) as { data: Provider | undefined }
  const invalidate = useInvalidateCache()
  const [notes, setNotes] = useState<string>(provider?.settings?.notes || '')

  const handleSave = async () => {
    await dataApiService.patch(`/providers/${providerId}` as any, {
      body: { providerSettings: { ...provider?.settings, notes } }
    })
    await invalidate([`/providers/${providerId}`])
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
