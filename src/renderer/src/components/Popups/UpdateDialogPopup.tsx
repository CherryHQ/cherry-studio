import { DownloadOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import { TopView } from '@renderer/components/TopView'
import { isMac } from '@renderer/config/constant'
import { handleSaveData, useAppDispatch } from '@renderer/store'
import { setUpdateState } from '@renderer/store/runtime'
import { Button, Modal } from 'antd'
import type { ReleaseNoteInfo, UpdateInfo } from 'builder-util-runtime'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Markdown from 'react-markdown'
import styled from 'styled-components'

const logger = loggerService.withContext('UpdateDialog')

// Old Team ID that requires manual install
const OLD_TEAM_ID = 'Q24M7JR2C4'
const DOWNLOAD_URL = 'https://www.cherry-ai.com/download'

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
  const [requiresManualInstall, setRequiresManualInstall] = useState(false)
  const dispatch = useAppDispatch()

  useEffect(() => {
    if (releaseInfo) {
      logger.info('Update dialog opened', { version: releaseInfo.version })
    }

    // Check if macOS user with old Team ID needs manual install
    if (isMac) {
      window.api.getSigningInfo().then((signingInfo) => {
        if (signingInfo.teamId === OLD_TEAM_ID) {
          setRequiresManualInstall(true)
          logger.info('Manual install required', { teamId: signingInfo.teamId })
        }
      })
    }

    setRequiresManualInstall(true)
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

  const handleManualInstall = async () => {
    setIsInstalling(true)
    try {
      await handleSaveData()
      const result = await window.api.manualInstallUpdate()

      if (!result.success) {
        setIsInstalling(false)
        if (result.error === 'User cancelled') {
          // User cancelled password dialog, do nothing
          return
        }
        logger.error('Manual install failed', { error: result.error })
        window.toast.error(t('update.manualInstallError'))
        // Fallback to download page
        window.api.openWebsite(DOWNLOAD_URL)
      }
      // If success, app will relaunch automatically
    } catch (error) {
      logger.error('Manual install error', error as Error)
      setIsInstalling(false)
      window.toast.error(t('update.manualInstallError'))
      window.api.openWebsite(DOWNLOAD_URL)
    }
  }

  const onCancel = () => {
    dispatch(setUpdateState({ manualCheck: false }))
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  const onIgnore = () => {
    dispatch(setUpdateState({ ignore: true, manualCheck: false }))
    setOpen(false)
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
        <Button key="later" onClick={onIgnore} disabled={isInstalling}>
          {t('update.later')}
        </Button>,
        requiresManualInstall ? (
          <Button key="install" type="primary" onClick={handleManualInstall} loading={isInstalling}>
            {t('update.install')}
          </Button>
        ) : (
          <Button key="install" type="primary" onClick={handleInstall} loading={isInstalling}>
            {t('update.install')}
          </Button>
        )
      ]}>
      <ModalBodyWrapper>
        {requiresManualInstall && (
          <div className="mb-4 flex items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-100 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800/50">
            <InfoCircleOutlined className="shrink-0 text-base text-neutral-500 dark:text-neutral-400" />
            <span className="flex-1 text-neutral-600 text-sm dark:text-neutral-300">
              {t('update.manualInstallInfo')}
            </span>
            <button
              type="button"
              onClick={() => window.api.openWebsite(DOWNLOAD_URL)}
              className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-3 py-1 font-medium text-sm text-white transition-colors"
              style={{ backgroundColor: 'var(--color-primary)' }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}>
              <DownloadOutlined className="text-xs" />
              {t('update.manualDownload')}
            </button>
          </div>
        )}
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
