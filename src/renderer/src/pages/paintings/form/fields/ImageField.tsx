import type { PaintingFieldComponentProps } from '../fieldRegistry'

export default function ImageField({
  fieldKey,
  onImageUpload,
  imagePreviewSrc,
  imagePlaceholder
}: PaintingFieldComponentProps) {
  return (
    <label className="flex min-h-32 cursor-pointer items-center justify-center rounded-md border border-border border-dashed bg-muted/20 p-3 hover:bg-muted/30">
      <input
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file && onImageUpload) {
            onImageUpload(fieldKey, file)
          }
          event.target.value = ''
        }}
      />
      {imagePreviewSrc ? (
        <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-md">
          <img src={imagePreviewSrc} alt="preview" className="max-h-32 object-contain" />
        </div>
      ) : (
        (imagePlaceholder ?? <span className="text-muted-foreground text-sm">Upload image</span>)
      )}
    </label>
  )
}
