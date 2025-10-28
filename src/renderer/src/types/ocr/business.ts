import type { DbOcrProviderCreate } from './data'
import type { DbOcrProviderUpdate } from './data'
import type { DbOcrProviderReplace } from './data'
import type { DbOcrProviderKey } from './data'
import type { DbOcrProvider } from './data'

// ==========================================================
//    Business layer Types
// ==========================================================
/**
 * Business-level representation of an OCR provider.
 * Mirrors the data layer but is intended for use in domain/business logic.
 */

export type OcrProviderBusiness = DbOcrProvider /**
 * Business-level representation of an OCR provider creation payload.
 */

export type OcrProviderCreateBusiness = DbOcrProviderCreate /**
 * Business-level representation of an OCR provider update payload.
 */

export type OcrProviderUpdateBusiness = DbOcrProviderUpdate /**
 * Business-level representation of an OCR provider replacement payload.
 */

export type OcrProviderReplaceBusiness = DbOcrProviderReplace /**
 * Business-level key type for identifying an OCR provider.
 */

export type OcrProviderKeyBusiness = DbOcrProviderKey
