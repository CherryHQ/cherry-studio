export function buildGeminiGenerateImageParams(): Record<string, any> {
  return {
    responseModalities: ['TEXT', 'IMAGE']
  }
}
