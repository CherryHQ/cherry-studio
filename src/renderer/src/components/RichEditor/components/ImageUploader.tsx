import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Dropzone,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ImageUp, Link, LoaderCircle, UploadCloud } from 'lucide-react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('RichEditorImageUploader')

interface ImageUploaderProps {
  /** Callback when image is selected/uploaded */
  onImageSelect: (imageUrl: string) => void
  /** Whether the uploader is visible */
  visible: boolean
  /** Callback when uploader should be closed */
  onClose: () => void
}

const MAX_IMAGE_SIZE = 10 * 1024 * 1024

// Function to convert file to base64 URL
const convertFileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('Failed to convert file to base64'))
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

export const ImageUploader: React.FC<ImageUploaderProps> = ({ onImageSelect, visible, onClose }) => {
  const { t } = useTranslation()
  const [urlInput, setUrlInput] = useState('')
  const [loading, setLoading] = useState(false)

  const validateFile = (file: File) => {
    const isImage = file.type.startsWith('image/')
    if (!isImage) {
      return t('richEditor.imageUploader.invalidType')
    }

    const isLt10M = file.size < MAX_IMAGE_SIZE
    if (!isLt10M) {
      return t('richEditor.imageUploader.tooLarge')
    }

    return null
  }

  const handleFileSelect = async (file: File) => {
    const validationError = validateFile(file)
    if (validationError) {
      window.toast.error(validationError)
      return
    }

    try {
      setLoading(true)

      // Convert to base64 and call callback
      const base64Url = await convertFileToBase64(file)
      onImageSelect(base64Url)
      window.toast.success(t('richEditor.imageUploader.uploadSuccess'))
      onClose()
    } catch (error) {
      logger.error('Image upload failed:', error as Error)
      window.toast.error(t('richEditor.imageUploader.uploadError'))
    } finally {
      setLoading(false)
    }
  }

  const handleUrlSubmit = () => {
    if (!urlInput.trim()) {
      window.toast.error(t('richEditor.imageUploader.urlRequired'))
      return
    }

    // Basic URL validation
    try {
      new URL(urlInput.trim())
      onImageSelect(urlInput.trim())
      window.toast.success(t('richEditor.imageUploader.embedSuccess'))
      setUrlInput('')
      onClose()
    } catch {
      window.toast.error(t('richEditor.imageUploader.invalidUrl'))
    }
  }

  const handleCancel = () => {
    setUrlInput('')
    onClose()
  }

  return (
    <Dialog open={visible} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{t('richEditor.imageUploader.title')}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="upload" className="gap-4">
          <TabsList>
            <TabsTrigger value="upload">
              <UploadCloud className="size-4" />
              {t('richEditor.imageUploader.upload')}
            </TabsTrigger>
            <TabsTrigger value="url">
              <Link className="size-4" />
              {t('richEditor.imageUploader.embedLink')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="pt-2">
            <Dropzone
              accept={{ 'image/*': [] }}
              disabled={loading}
              maxFiles={1}
              validator={(file) => {
                const validationError = validateFile(file)
                return validationError ? { code: 'image-validation-error', message: validationError } : null
              }}
              onDrop={(files) => {
                const file = files[0]
                if (file) {
                  void handleFileSelect(file)
                }
              }}
              onError={(err) => {
                logger.error('Dropzone validation failed:', err)
                window.toast.error(err.message || t('richEditor.imageUploader.invalidType'))
              }}
              className="min-h-44 border-dashed bg-muted/20 hover:bg-accent/40">
              <div className="flex flex-col items-center justify-center gap-2 text-center">
                <div className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  {loading ? <LoaderCircle className="size-5 animate-spin" /> : <ImageUp className="size-5" />}
                </div>
                <div className="font-medium text-sm">
                  {loading ? t('richEditor.imageUploader.uploading') : t('richEditor.imageUploader.uploadText')}
                </div>
                <div className="text-muted-foreground text-xs">
                  {loading ? t('richEditor.imageUploader.processing') : t('richEditor.imageUploader.uploadHint')}
                </div>
              </div>
            </Dropzone>
          </TabsContent>

          <TabsContent value="url" className="pt-2">
            <div className="flex items-center justify-center gap-3">
              <div className="relative flex-1">
                <Link className="-translate-y-1/2 absolute top-1/2 left-3 size-4 text-muted-foreground" />
                <Input
                  placeholder={t('richEditor.imageUploader.urlPlaceholder')}
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleUrlSubmit()
                    }
                  }}
                  className="pl-9"
                />
              </div>
              <Button variant="outline" onClick={() => setUrlInput('')}>
                {t('common.clear')}
              </Button>
              <Button onClick={handleUrlSubmit} disabled={!urlInput.trim()}>
                {t('richEditor.imageUploader.embedImage')}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
