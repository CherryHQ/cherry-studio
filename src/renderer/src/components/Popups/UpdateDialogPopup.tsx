import { loggerService } from '@logger'
import { TopView } from '@renderer/components/TopView'
import { handleSaveData } from '@renderer/store'
import { Button, Modal } from 'antd'
import type { ReleaseNoteInfo, UpdateInfo } from 'builder-util-runtime'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Markdown from 'react-markdown'
import styled from 'styled-components'

const logger = loggerService.withContext('UpdateDialog')

interface ShowParams {
  releaseInfo: UpdateInfo | null
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ releaseInfo, resolve }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const [isInstalling, setIsInstalling] = useState(false)

  useEffect(() => {
    if (releaseInfo) {
      logger.info('Update dialog opened', { version: releaseInfo.version })
    }
  }, [releaseInfo])

  const handleInstall = async () => {
    setIsInstalling(true)
    try {
      await handleSaveData()
      await window.api.quitAndInstall()
      setOpen(false)
    } catch (error) {
      logger.error('Failed to save data before update', error as Error)
      setIsInstalling(false)
      window.toast.error(t('update.saveDataError'))
    }
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  UpdateDialogPopup.hide = onCancel

  const releaseNotes = releaseInfo?.releaseNotes

  return (
    <Modal
      title={
        <ModalHeaderWrapper>
          <h3>{t('update.title')}</h3>
          <p>{t('update.message').replace('{{version}}', releaseInfo?.version || '')}</p>
        </ModalHeaderWrapper>
      }
      open={open}
      onCancel={onCancel}
      afterClose={onClose}
      transitionName="animation-move-down"
      centered
      width={720}
      footer={[
        <Button key="later" onClick={onCancel} disabled={isInstalling}>
          {t('update.later')}
        </Button>,
        <Button key="install" type="primary" onClick={handleInstall} loading={isInstalling}>
          {t('update.install')}
        </Button>
      ]}>
      <ModalBodyWrapper>
        <ReleaseNotesWrapper className="markdown">
          <Markdown>
            {typeof releaseNotes === 'string'
              ? releaseNotes
              : Array.isArray(releaseNotes)
                ? releaseNotes
                    .map((note: ReleaseNoteInfo) => note.note)
                    .filter(Boolean)
                    .join('\n\n')
                : t('update.noReleaseNotes')}
          </Markdown>
        </ReleaseNotesWrapper>
      </ModalBodyWrapper>
    </Modal>
  )
}

const TopViewKey = 'UpdateDialogPopup'

export default class UpdateDialogPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}

const ModalHeaderWrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;

  h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--color-text-1);
  }

  p {
    margin: 0;
    font-size: 14px;
    color: var(--color-text-2);
  }
`

const ModalBodyWrapper = styled.div`
  max-height: 450px;
  overflow-y: auto;
  padding: 12px 0;
`

const ReleaseNotesWrapper = styled.div`
  background-color: var(--color-bg-2);
  border-radius: 8px;

  p {
    margin: 0 0 12px 0;
    color: var(--color-text-2);
    font-size: 14px;
    line-height: 1.6;

    &:last-child {
      margin-bottom: 0;
    }
  }

  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    margin: 16px 0 8px 0;
    color: var(--color-text-1);
    font-weight: 600;

    &:first-child {
      margin-top: 0;
    }
  }

  ul,
  ol {
    margin: 8px 0;
    padding-left: 24px;
    color: var(--color-text-2);
  }

  li {
    margin: 4px 0;
  }

  code {
    padding: 2px 6px;
    background-color: var(--color-bg-3);
    border-radius: 4px;
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 13px;
  }

  pre {
    padding: 12px;
    background-color: var(--color-bg-3);
    border-radius: 6px;
    overflow-x: auto;

    code {
      padding: 0;
      background-color: transparent;
    }
  }
`
