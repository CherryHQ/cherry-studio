import type {
  BuiltinOcrProvider,
  BuiltinOcrProviderId,
  OcrOvProvider,
  OcrPpocrProvider,
  OcrSystemProvider,
  OcrTesseractProvider,
  TesseractLangCode
} from '@types'

import type { TranslateLanguageCode } from '../../../src/renderer/src/types/translate'

export const tesseract: OcrTesseractProvider = {
  id: 'tesseract',
  name: 'Tesseract',
  capabilities: {
    image: true
  },
  config: {
    langs: {
      chi_sim: true,
      chi_tra: true,
      eng: true
    },
    enabled: false
  }
} as const

export const systemOcr: OcrSystemProvider = {
  id: 'system',
  name: 'System',
  capabilities: {
    image: true
    // pdf: true
  },
  config: {
    langs: ['en-us'],
    enabled: false
  }
} as const satisfies OcrSystemProvider

export const ppocrOcr: OcrPpocrProvider = {
  id: 'paddleocr',
  name: 'PaddleOCR',
  capabilities: {
    image: true
    // pdf: true
  },
  config: { apiUrl: '', enabled: false }
} as const

export const ovOcr: OcrOvProvider = {
  id: 'ovocr',
  name: 'Intel OV(NPU) OCR',
  capabilities: {
    image: true
    // pdf: true
  },
  config: {
    enabled: false
  }
} as const satisfies OcrOvProvider

export const INITIAL_BUILTIN_OCR_PROVIDER_MAP = {
  tesseract,
  system: systemOcr,
  paddleocr: ppocrOcr,
  ovocr: ovOcr
} as const satisfies Record<BuiltinOcrProviderId, BuiltinOcrProvider>

export const BUILTIN_OCR_PROVIDERS: BuiltinOcrProvider[] = Object.values(INITIAL_BUILTIN_OCR_PROVIDER_MAP)

export const TESSERACT_LANG_MAP: Record<TranslateLanguageCode, TesseractLangCode> = {
  'af-za': 'afr',
  'am-et': 'amh',
  'ar-sa': 'ara',
  'as-in': 'asm',
  'az-az': 'aze',
  'az-cyrl-az': 'aze_cyrl',
  'be-by': 'bel',
  'bn-bd': 'ben',
  'bo-cn': 'bod',
  'bs-ba': 'bos',
  'bg-bg': 'bul',
  'ca-es': 'cat',
  'ceb-ph': 'ceb',
  'cs-cz': 'ces',
  'zh-cn': 'chi_sim',
  'zh-tw': 'chi_tra',
  'chr-us': 'chr',
  'cy-gb': 'cym',
  'da-dk': 'dan',
  'de-de': 'deu',
  'dz-bt': 'dzo',
  'el-gr': 'ell',
  'en-us': 'eng',
  'enm-gb': 'enm',
  'eo-world': 'epo',
  'et-ee': 'est',
  'eu-es': 'eus',
  'fa-ir': 'fas',
  'fi-fi': 'fin',
  'fr-fr': 'fra',
  'frk-de': 'frk',
  'frm-fr': 'frm',
  'ga-ie': 'gle',
  'gl-es': 'glg',
  'grc-gr': 'grc',
  'gu-in': 'guj',
  'ht-ht': 'hat',
  'he-il': 'heb',
  'hi-in': 'hin',
  'hr-hr': 'hrv',
  'hu-hu': 'hun',
  'iu-ca': 'iku',
  'id-id': 'ind',
  'is-is': 'isl',
  'it-it': 'ita',
  'ita-it': 'ita_old',
  'jv-id': 'jav',
  'ja-jp': 'jpn',
  'kn-in': 'kan',
  'ka-ge': 'kat',
  'kat-ge': 'kat_old',
  'kk-kz': 'kaz',
  'km-kh': 'khm',
  'ky-kg': 'kir',
  'ko-kr': 'kor',
  'ku-tr': 'kur',
  'la-la': 'lao',
  'la-va': 'lat',
  'lv-lv': 'lav',
  'lt-lt': 'lit',
  'ml-in': 'mal',
  'mr-in': 'mar',
  'mk-mk': 'mkd',
  'mt-mt': 'mlt',
  'ms-my': 'msa',
  'my-mm': 'mya',
  'ne-np': 'nep',
  'nl-nl': 'nld',
  'no-no': 'nor',
  'or-in': 'ori',
  'pa-in': 'pan',
  'pl-pl': 'pol',
  'pt-pt': 'por',
  'ps-af': 'pus',
  'ro-ro': 'ron',
  'ru-ru': 'rus',
  'sa-in': 'san',
  'si-lk': 'sin',
  'sk-sk': 'slk',
  'sl-si': 'slv',
  'es-es': 'spa',
  'spa-es': 'spa_old',
  'sq-al': 'sqi',
  'sr-rs': 'srp',
  'sr-latn-rs': 'srp_latn',
  'sw-tz': 'swa',
  'sv-se': 'swe',
  'syr-sy': 'syr',
  'ta-in': 'tam',
  'te-in': 'tel',
  'tg-tj': 'tgk',
  'tl-ph': 'tgl',
  'th-th': 'tha',
  'ti-er': 'tir',
  'tr-tr': 'tur',
  'ug-cn': 'uig',
  'uk-ua': 'ukr',
  'ur-pk': 'urd',
  'uz-uz': 'uzb',
  'uz-cyrl-uz': 'uzb_cyrl',
  'vi-vn': 'vie',
  'yi-us': 'yid'
}
