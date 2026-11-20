import { useEffect, useState } from 'react'
import Cropper, { type Area, type MediaSize } from 'react-easy-crop'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Slider
} from '@cherrystudio/ui'
import i18n from '@renderer/i18n/resolver'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import type { ImageCropArea } from '@renderer/utils/image'

const MIN_ZOOM = 1
const MAX_ZOOM = 4

export interface AvatarCropOptions {
  file: File
  /** How the avatar is shown: the user avatar is round, Agent and Assistant avatars are square. */
  shape: 'square' | 'round'
}

/**
 * Frames an uploaded avatar before it is saved. Resolves the framed square in the image's own pixels,
 * or `null` when the user cancels, so nothing is saved.
 */
function AvatarCropDialog({
  file,
  shape,
  open,
  resolve
}: AvatarCropOptions & PopupInjectedProps<ImageCropArea | null>) {
  const [openState, setOpenState] = useState(open)
  const [src, setSrc] = useState<string>()
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const [framed, setFramed] = useState<Area>()
  const [media, setMedia] = useState<MediaSize>()

  useEffect(() => setOpenState(open), [open])
  useEffect(() => {
    const url = URL.createObjectURL(file)
    setSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const close = (result: ImageCropArea | null) => {
    setOpenState(false)
    resolve(result)
  }

  // The library's pixel area is rounded, which empties or shifts crops of tiny images; scale its exact percentages.
  const area: ImageCropArea | undefined =
    framed && media
      ? {
          x: (framed.x * media.naturalWidth) / 100,
          y: (framed.y * media.naturalHeight) / 100,
          width: (framed.width * media.naturalWidth) / 100,
          height: (framed.height * media.naturalHeight) / 100
        }
      : undefined

  return (
    <Dialog open={openState} onOpenChange={(next) => !next && close(null)}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{i18n.t('avatar_crop.title')}</DialogTitle>
          <DialogDescription>{i18n.t('avatar_crop.hint')}</DialogDescription>
        </DialogHeader>
        <div className="relative h-72 overflow-hidden rounded-lg bg-muted">
          {src ? (
            <Cropper
              image={src}
              crop={crop}
              zoom={zoom}
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
              aspect={1}
              cropShape={shape === 'round' ? 'round' : 'rect'}
              showGrid={false}
              // The library's faint white edge disappears on a dark dialog; the frame is a selection.
              style={{ cropAreaStyle: { border: '2px solid var(--primary)' } }}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onMediaLoaded={setMedia}
              onCropComplete={setFramed}
            />
          ) : null}
        </div>
        <Slider
          value={[zoom]}
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.01}
          getThumbAriaLabel={() => i18n.t('avatar_crop.zoom')}
          onValueChange={([value]) => setZoom(value)}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => close(null)}>
            {i18n.t('common.cancel')}
          </Button>
          <Button disabled={!area} onClick={() => area && close(area)}>
            {i18n.t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export const AvatarCropPopup = createPopup<AvatarCropOptions, ImageCropArea | null>(AvatarCropDialog, {
  dismissResult: null
})
