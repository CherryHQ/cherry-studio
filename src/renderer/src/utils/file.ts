export const fileToBase64 = async (filePath: string) => {
  const result = await window.api.file.base64File(filePath)
  return {
    data: result.data,
    mimeType: result.mime
  }
}
