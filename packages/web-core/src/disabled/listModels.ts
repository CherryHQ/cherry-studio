// Stand-in for `ai/provider/listModels`: listing a provider's remote models is desktop-only.
import { unsupported } from './unsupported'

export const listModels = unsupported('Remote model listing')
export const probeOllamaModel = unsupported('Ollama')
