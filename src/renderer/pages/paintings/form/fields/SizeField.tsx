import { Input, RowFlex } from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

import type { PaintingFieldComponentProps } from '../fieldRegistry'

export default function SizeField({ item, painting, onChange }: PaintingFieldComponentProps) {
  const { t } = useTranslation()
  const { widthKey = 'width', heightKey = 'height', validation = {} } = item
  const widthValue = painting[widthKey] ?? ''
  const heightValue = painting[heightKey] ?? ''

  // SizeField only renders when the parent chip widget has `sizeKey === 'custom'`
  // (see `condition` on the customSize item in imageGenerationToFields). The
  // typed width/height persist under `widthKey`/`heightKey` (e.g.
  // `customSize_width`/`customSize_height`); `canonicalGenerate` composes them
  // into the wire `imageSize` when `size === 'custom'`. They are NOT flattened
  // back into `sizeKey` here — doing so would break the `condition` that keeps
  // this widget rendered.
  return (
    <div className="flex flex-col gap-2">
      <RowFlex className="items-center gap-2">
        <Input
          aria-label={t('paintings.generate.width')}
          placeholder={t('paintings.generate.width')}
          type="number"
          value={widthValue === undefined || widthValue === null ? '' : String(widthValue)}
          onChange={(event) => {
            const value = event.target.value === '' ? '' : Number(event.target.value)
            onChange({ [widthKey]: value })
          }}
          min={validation.minWidth}
          max={validation.maxWidth}
          className="flex-1"
        />
        <span className="text-muted-foreground text-xs">x</span>
        <Input
          aria-label={t('paintings.generate.height')}
          placeholder={t('paintings.generate.height')}
          type="number"
          value={heightValue === undefined || heightValue === null ? '' : String(heightValue)}
          onChange={(event) => {
            const value = event.target.value === '' ? '' : Number(event.target.value)
            onChange({ [heightKey]: value })
          }}
          min={validation.minHeight}
          max={validation.maxHeight}
          className="flex-1"
        />
        <span className="text-muted-foreground text-xs">px</span>
      </RowFlex>
    </div>
  )
}
