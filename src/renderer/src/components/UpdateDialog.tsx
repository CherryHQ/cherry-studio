import { loggerService } from '@logger'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Progress,
  ScrollShadow
} from '@heroui/react'
import { UpdateInfo } from 'builder-util-runtime'
import { Download } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Markdown from 'react-markdown'

const logger = loggerService.withContext('UpdateDialog')

interface UpdateDialogProps {
  isOpen: boolean
  onClose: () => void
  updateInfo?: UpdateInfo | null
  onInstall: () => void
  onDownload?: () => void
  downloadProgress?: {
    bytesPerSecond: number
    percent: number
    transferred: number
    total: number
  }
  isDownloading?: boolean
  isDownloaded?: boolean
}

const UpdateDialog: React.FC<UpdateDialogProps> = ({
  isOpen,
  onClose,
  updateInfo,
  onInstall,
  onDownload,
  downloadProgress,
  isDownloading = false,
  isDownloaded = false
}) => {
  const { t } = useTranslation()
  const [showFullNotes, setShowFullNotes] = useState(false)

  useEffect(() => {
    if (isOpen) {
      logger.info('Update dialog opened', { version: updateInfo?.version })
    }
  }, [isOpen, updateInfo])

  const formatReleaseNotes = (notes: string | any[] | null | undefined): string => {
    if (!notes) return t('update.noReleaseNotes')

    if (typeof notes === 'string') {
      // Ensure proper markdown formatting with double line breaks
      return notes.replace(/\n(?!\n)/g, '\n\n')
    }

    if (Array.isArray(notes)) {
      return notes.map((note: any) => note.note).join('\n\n')
    }

    return t('update.noReleaseNotes')
  }

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
  }

  const formatSpeed = (bytesPerSecond: number): string => {
    return formatBytes(bytesPerSecond) + '/s'
  }

  const releaseNotes = formatReleaseNotes(updateInfo?.releaseNotes)
  const displayNotes = showFullNotes ? releaseNotes : releaseNotes.slice(0, 500)
  const shouldShowMore = releaseNotes.length > 500

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="2xl"
      scrollBehavior="inside"
      classNames={{
        base: 'max-h-[85vh]',
        header: 'border-b border-divider',
        footer: 'border-t border-divider'
      }}>
      <ModalContent>
        {(onModalClose) => (
          <>
            <ModalHeader className="flex flex-col gap-1">
              <h3 className="text-lg font-semibold">{t('update.title')}</h3>
              <p className="text-small text-default-500">
                {t('update.message').replace('{{version}}', updateInfo?.version || '')}
              </p>
            </ModalHeader>

            <ModalBody>
              <div className="flex flex-col gap-4">
                {/* Version Info */}
                <div className="flex flex-col gap-2 rounded-lg bg-default-100 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-small font-medium text-default-600">
                      {t('update.newVersion')}
                    </span>
                    <span className="text-small font-semibold">{updateInfo?.version}</span>
                  </div>
                  {updateInfo?.releaseDate && (
                    <div className="flex items-center justify-between">
                      <span className="text-small font-medium text-default-600">
                        {t('update.releaseDate')}
                      </span>
                      <span className="text-small">
                        {new Date(updateInfo.releaseDate).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                </div>

                {/* Download Progress */}
                {isDownloading && downloadProgress && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-small font-medium">
                        {t('update.downloading')}
                      </span>
                      <span className="text-small text-default-500">
                        {Math.round(downloadProgress.percent)}%
                      </span>
                    </div>
                    <Progress
                      value={downloadProgress.percent}
                      className="mb-1"
                      size="sm"
                      color="primary"
                    />
                    <div className="flex items-center justify-between text-tiny text-default-500">
                      <span>
                        {formatBytes(downloadProgress.transferred)} / {formatBytes(downloadProgress.total)}
                      </span>
                      <span>{formatSpeed(downloadProgress.bytesPerSecond)}</span>
                    </div>
                  </div>
                )}

                {/* Release Notes */}
                <div className="flex flex-col gap-2">
                  <h4 className="text-small font-semibold">{t('update.releaseNotes')}</h4>
                  <ScrollShadow className="max-h-[300px]" hideScrollBar>
                    <div className="markdown rounded-lg bg-default-50 p-4">
                      <Markdown>
                        {displayNotes + (!showFullNotes && shouldShowMore ? '...' : '')}
                      </Markdown>
                    </div>
                  </ScrollShadow>
                  {shouldShowMore && (
                    <Button
                      size="sm"
                      variant="light"
                      onPress={() => setShowFullNotes(!showFullNotes)}
                      className="self-start">
                      {showFullNotes ? t('update.showLess') : t('update.showMore')}
                    </Button>
                  )}
                </div>
              </div>
            </ModalBody>

            <ModalFooter>
              <Button
                variant="light"
                onPress={() => {
                  onModalClose()
                  onClose()
                }}>
                {t('update.later')}
              </Button>

              {!isDownloaded && !isDownloading && onDownload && (
                <Button
                  color="primary"
                  variant="flat"
                  startContent={<Download className="h-4 w-4" />}
                  onPress={onDownload}>
                  {t('update.download')}
                </Button>
              )}

              {(isDownloaded || !onDownload) && (
                <Button
                  color="primary"
                  onPress={() => {
                    onInstall()
                    onModalClose()
                  }}
                  isDisabled={isDownloading}>
                  {t('update.install')}
                </Button>
              )}
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  )
}

export default UpdateDialog