import doc2xLogo from '@renderer/assets/images/fileProcessors/doc2x.png'
import mineruLogo from '@renderer/assets/images/fileProcessors/mineru.jpg'
import mistralLogo from '@renderer/assets/images/fileProcessors/mistral.png'
import paddleOcrLogo from '@renderer/assets/images/fileProcessors/paddleocr.png'
import tesseractLogo from '@renderer/assets/images/fileProcessors/tesseract.png'
import type { TesseractLangCode, TranslateLanguageCode } from '@renderer/types'
import type { FileProcessorId } from '@shared/data/presets/file-processing'

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

type FileProcessorConfig = {
  websites: {
    official: string
    apiKey?: string
  }
}

export const FILE_PROCESSOR_WEBSITE: Partial<Record<FileProcessorId, FileProcessorConfig>> = {
  tesseract: { websites: { official: 'https://github.com/tesseract-ocr/tesseract' } },
  system: { websites: { official: '' } },
  paddleocr: {
    websites: {
      official: 'https://aistudio.baidu.com/paddleocr',
      apiKey: 'https://aistudio.baidu.com/account/accessToken'
    }
  },
  ovocr: { websites: { official: 'https://www.intel.com/content/www/us/en/homepage.html' } },
  mineru: { websites: { official: 'https://mineru.net/', apiKey: 'https://mineru.net/apiManage/token' } },
  doc2x: { websites: { official: 'https://doc2x.noedgeai.com/', apiKey: 'https://open.noedgeai.com/apiKeys' } },
  mistral: { websites: { official: 'https://mistral.ai/', apiKey: 'https://console.mistral.ai/' } },
  'open-mineru': { websites: { official: 'https://github.com/opendatalab/MinerU' } }
}

export const FILE_PROCESSOR_LOGOS: Partial<Record<FileProcessorId, string>> = {
  doc2x: doc2xLogo,
  mineru: mineruLogo,
  mistral: mistralLogo,
  'open-mineru': mineruLogo,
  paddleocr: paddleOcrLogo,
  tesseract: tesseractLogo
}

export const FILE_PROCESSOR_MODELS: Partial<Record<FileProcessorId, string[]>> = {
  mistral: ['mistral-ocr-latest'],
  paddleocr: ['PP-OCRv5', 'PP-StructureV3', 'PaddleOCR-VL', 'PaddleOCR-VL-1.5']
}
