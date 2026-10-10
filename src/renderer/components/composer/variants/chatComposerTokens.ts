import { composerFileTokenId, composerKnowledgeBaseTokenId } from './shared/composerTokens'

export {
  fileToComposerToken,
  getComposerTokenIds,
  hasComposerToken,
  knowledgeBaseToComposerToken
} from './shared/composerTokens'

export const chatComposerTokenId = {
  file: composerFileTokenId,
  knowledge: composerKnowledgeBaseTokenId
}
