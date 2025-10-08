import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, ScrollShadow } from '@heroui/react'
import { loggerService } from '@logger'
import { handleSaveData } from '@renderer/store'
import { UpdateInfo } from 'builder-util-runtime'
import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Markdown from 'react-markdown'

const logger = loggerService.withContext('UpdateDialog')

interface UpdateDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  releaseInfo: UpdateInfo | null
}

const UpdateDialog: React.FC<UpdateDialogProps> = ({ isOpen, onOpenChange, releaseInfo }) => {
  const { t } = useTranslation()

  useEffect(() => {
    if (isOpen && releaseInfo) {
      logger.info('Update dialog opened', { version: releaseInfo.version })
    }
  }, [isOpen, releaseInfo])

  const handleInstall = async () => {
    await handleSaveData()
    await window.api.quitAndInstall()
  }

  const handleClose = () => {
    onOpenChange(false)
  }

  const releaseNotes = releaseInfo?.releaseNotes

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
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
              <h3 className="font-semibold text-lg">{t('update.title')}</h3>
              <p className="text-default-500 text-small">
                {t('update.message').replace('{{version}}', releaseInfo?.version || '')}
              </p>
            </ModalHeader>

            <ModalBody>
              <ScrollShadow className="max-h-[450px]" hideScrollBar>
                <div className="markdown rounded-lg bg-default-50 p-4">
                  <Markdown>
                    {typeof releaseNotes === 'string'
                      ? releaseNotes
                      : Array.isArray(releaseNotes)
                        ? releaseNotes.map((note: any) => note.note).join('\n\n')
                        : t('update.noReleaseNotes')}
                  </Markdown>
                </div>
              </ScrollShadow>
            </ModalBody>

            <ModalFooter>
              <Button
                variant="light"
                onPress={() => {
                  onModalClose()
                  handleClose()
                }}>
                {t('update.later')}
              </Button>

              <Button
                color="primary"
                onPress={() => {
                  handleInstall()
                  onModalClose()
                }}>
                {t('update.install')}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  )
}

export default UpdateDialog
