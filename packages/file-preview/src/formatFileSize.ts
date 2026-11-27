export function formatFileSize(size: number): string {
  if (size >= 1024 ** 3) return `${(size / 1024 ** 3).toFixed(1)} GB`
  if (size >= 1024 ** 2) return `${(size / 1024 ** 2).toFixed(1)} MB`
  return `${(size / 1024).toFixed(size >= 1024 ? 0 : 2)} KB`
}
