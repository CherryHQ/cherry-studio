// Stand-ins for providers that need the desktop: GitHub Copilot and Grok CLI read local
// credentials, Vertex AI signs with Node's Google auth library, and Ollama talks to the user's machine.
import { unsupported, unsupportedService } from './unsupported'

export const copilotService = unsupportedService('GitHub Copilot')
export const vertexAiService = unsupportedService('Vertex AI')
export const buildGrokCliRequestHeaders = unsupported('Grok CLI')
export const rewriteGrokCliResponsesBody = unsupported('Grok CLI')
export const createOllamaWithImageModel = unsupported('Ollama')
