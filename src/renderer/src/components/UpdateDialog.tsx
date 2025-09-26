import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, ScrollShadow } from '@heroui/react'
import { loggerService } from '@logger'
import { UpdateInfo } from 'builder-util-runtime'
import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Markdown from 'react-markdown'

const logger = loggerService.withContext('UpdateDialog')

interface UpdateDialogProps {
  isOpen: boolean
  onClose: () => void
  updateInfo?: UpdateInfo | null
  onInstall: () => void
}

const UpdateDialog: React.FC<UpdateDialogProps> = ({ isOpen, onClose, updateInfo, onInstall }) => {
  const { t } = useTranslation()

  useEffect(() => {
    if (isOpen) {
      logger.info('Update dialog opened', { version: updateInfo?.version })
    }
  }, [isOpen, updateInfo])

  const releaseNotes = updateInfo?.releaseNotes

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
              <div className="flex flex-col gap-2">
                <h4 className="text-small font-semibold">{t('update.releaseNotes')}</h4>
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

              <Button
                color="primary"
                onPress={() => {
                  onInstall()
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