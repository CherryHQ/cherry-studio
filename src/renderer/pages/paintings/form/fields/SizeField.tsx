import { InputNumber, RowFlex } from '@cherrystudio/ui'
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
        <InputNumber
          aria-label={t('paintings.generate.width')}
          placeholder={t('paintings.generate.width')}
          value={widthValue === undefined || widthValue === null ? null : Number(widthValue)}
          onBlur={(value) => onChange({ [widthKey]: value === null ? '' : value })}
          min={validation.minWidth}
          max={validation.maxWidth}
          step={1}
          className="flex-1"
        />
        <span className="text-muted-foreground text-xs">x</span>
        <InputNumber
          aria-label={t('paintings.generate.height')}
          placeholder={t('paintings.generate.height')}
          value={heightValue === undefined || heightValue === null ? null : Number(heightValue)}
          onBlur={(value) => onChange({ [heightKey]: value === null ? '' : value })}
          min={validation.minHeight}
          max={validation.maxHeight}
          step={1}
          className="flex-1"
        />
        <span className="text-muted-foreground text-xs">px</span>
      </RowFlex>
    </div>
  )
}
