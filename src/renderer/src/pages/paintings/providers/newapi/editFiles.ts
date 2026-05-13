const editImageFilesStore = new Map<string, File[]>()

export function getEditImageFiles(paintingId: string): File[] {
  return editImageFilesStore.get(paintingId) || []
}

export function addEditImageFile(paintingId: string, file: File): void {
  const current = getEditImageFiles(paintingId)
  editImageFilesStore.set(paintingId, [...current, file])
}

export function removeEditImageFile(paintingId: string, index: number): void {
  const current = getEditImageFiles(paintingId)
  editImageFilesStore.set(
    paintingId,
    current.filter((_, currentIndex) => currentIndex !== index)
  )
}

export function clearEditImageFiles(paintingId: string): void {
  editImageFilesStore.delete(paintingId)
}

export function moveEditImageFiles(fromPaintingId: string, toPaintingId: string): void {
  if (fromPaintingId === toPaintingId) {
    return
  }

  const files = editImageFilesStore.get(fromPaintingId)
  if (!files) {
    return
  }

  editImageFilesStore.set(toPaintingId, files)
  editImageFilesStore.delete(fromPaintingId)
}
