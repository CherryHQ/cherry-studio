import { Button } from '@cherrystudio/ui'
import IcImageUp from '@renderer/assets/images/paintings/ic_ImageUp.svg'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'

import PaintingSectionTitle from '../../components/PaintingSectionTitle'
import type { OpenApiCompatiblePaintingData as PaintingData } from '../../model/types/paintingData'
import { addEditImageFile, getEditImageFiles, removeEditImageFile } from './editFiles'

interface NewApiSettingProps {
  providerId: string
  painting: PaintingData
  modelOptions: Array<{ value: string; label: string; group?: string; [k: string]: any }>
  patchPainting: (updates: Partial<PaintingData>) => void
  tab: string
}

function renderEmptyModelState(providerId: string, t: TFunction) {
  return (
    <div className="mt-6 rounded-md border border-border border-dashed bg-muted/10 p-6 text-center">
      <div className="mb-3 text-muted-foreground text-sm">
        {t('paintings.no_image_generation_model', {
          endpoint_type: t('endpoint_type.image-generation')
        })}
      </div>
      <Button
        variant="default"
        onClick={() => {
          void window.navigate({ to: '/settings/provider', search: { id: providerId } })
        }}>
        {t('paintings.go_to_settings')}
      </Button>
    </div>
  )
}

function renderEditSetting(paintingId: string, patchPainting: NewApiSettingProps['patchPainting'], t: TFunction) {
  const editFiles = getEditImageFiles(paintingId)

  return (
    <div className="mt-1">
      <PaintingSectionTitle className="mt-0 mb-3">{t('paintings.input_image')}</PaintingSectionTitle>
      <div className="flex flex-col gap-2">
        <label className="flex min-h-[60px] cursor-pointer items-center justify-center gap-2 rounded-md border border-border border-dashed bg-muted/20 hover:bg-muted/30">
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif"
            multiple
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files || [])
              files.forEach((file) => addEditImageFile(paintingId, file))
              event.target.value = ''
              patchPainting({} as Partial<PaintingData>)
            }}
          />
          <img src={IcImageUp} alt={t('common.upload_image')} className="h-5 w-5" />
          <span className="text-muted-foreground text-sm">{t('paintings.input_image')}</span>
        </label>

        {editFiles.length > 0 && (
          <div className="flex flex-col gap-2">
            {editFiles.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                className="flex items-center justify-between rounded-md border border-border bg-muted/10 px-3 py-2 text-sm">
                <span className="truncate">{file.name || `image_${index + 1}.png`}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    removeEditImageFile(paintingId, index)
                    patchPainting({} as Partial<PaintingData>)
                  }}>
                  {t('common.delete')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function NewApiSetting({ providerId, painting, modelOptions, patchPainting, tab }: NewApiSettingProps) {
  const { t } = useTranslation()
  const actualProviderId = painting.providerId || providerId

  if (modelOptions.length === 0) {
    return renderEmptyModelState(actualProviderId, t)
  }

  if (tab === 'edit') {
    return renderEditSetting(painting.id, patchPainting, t)
  }

  return null
}
