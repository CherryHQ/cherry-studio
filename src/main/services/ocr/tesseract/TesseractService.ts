import { loggerService } from '@logger'
import { getIpCountry } from '@main/utils/ipService'
import { TesseractLangsDownloadUrl } from '@shared/config/constant'
import { app } from 'electron'
import path from 'path'
import Tesseract, { createWorker } from 'tesseract.js'

const logger = loggerService.withContext('TesseractService')

// const languageCodeMap: Record<string, string> = {
//   'af-za': 'afr',
//   'am-et': 'amh',
//   'ar-sa': 'ara',
//   'as-in': 'asm',
//   'az-az': 'aze',
//   'az-cyrl-az': 'aze_cyrl',
//   'be-by': 'bel',
//   'bn-bd': 'ben',
//   'bo-cn': 'bod',
//   'bs-ba': 'bos',
//   'bg-bg': 'bul',
//   'ca-es': 'cat',
//   'ceb-ph': 'ceb',
//   'cs-cz': 'ces',
//   'zh-cn': 'chi_sim',
//   'zh-tw': 'chi_tra',
//   'chr-us': 'chr',
//   'cy-gb': 'cym',
//   'da-dk': 'dan',
//   'de-de': 'deu',
//   'dz-bt': 'dzo',
//   'el-gr': 'ell',
//   'en-us': 'eng',
//   'enm-gb': 'enm',
//   'eo-world': 'epo',
//   'et-ee': 'est',
//   'eu-es': 'eus',
//   'fa-ir': 'fas',
//   'fi-fi': 'fin',
//   'fr-fr': 'fra',
//   'frk-de': 'frk',
//   'frm-fr': 'frm',
//   'ga-ie': 'gle',
//   'gl-es': 'glg',
//   'grc-gr': 'grc',
//   'gu-in': 'guj',
//   'ht-ht': 'hat',
//   'he-il': 'heb',
//   'hi-in': 'hin',
//   'hr-hr': 'hrv',
//   'hu-hu': 'hun',
//   'iu-ca': 'iku',
//   'id-id': 'ind',
//   'is-is': 'isl',
//   'it-it': 'ita',
//   'ita-it': 'ita_old',
//   'jv-id': 'jav',
//   'ja-jp': 'jpn',
//   'kn-in': 'kan',
//   'ka-ge': 'kat',
//   'kat-ge': 'kat_old',
//   'kk-kz': 'kaz',
//   'km-kh': 'khm',
//   'ky-kg': 'kir',
//   'ko-kr': 'kor',
//   'ku-tr': 'kur',
//   'la-la': 'lao',
//   'la-va': 'lat',
//   'lv-lv': 'lav',
//   'lt-lt': 'lit',
//   'ml-in': 'mal',
//   'mr-in': 'mar',
//   'mk-mk': 'mkd',
//   'mt-mt': 'mlt',
//   'ms-my': 'msa',
//   'my-mm': 'mya',
//   'ne-np': 'nep',
//   'nl-nl': 'nld',
//   'no-no': 'nor',
//   'or-in': 'ori',
//   'pa-in': 'pan',
//   'pl-pl': 'pol',
//   'pt-pt': 'por',
//   'ps-af': 'pus',
//   'ro-ro': 'ron',
//   'ru-ru': 'rus',
//   'sa-in': 'san',
//   'si-lk': 'sin',
//   'sk-sk': 'slk',
//   'sl-si': 'slv',
//   'es-es': 'spa',
//   'spa-es': 'spa_old',
//   'sq-al': 'sqi',
//   'sr-rs': 'srp',
//   'sr-latn-rs': 'srp_latn',
//   'sw-tz': 'swa',
//   'sv-se': 'swe',
//   'syr-sy': 'syr',
//   'ta-in': 'tam',
//   'te-in': 'tel',
//   'tg-tj': 'tgk',
//   'tl-ph': 'tgl',
//   'th-th': 'tha',
//   'ti-er': 'tir',
//   'tr-tr': 'tur',
//   'ug-cn': 'uig',
//   'uk-ua': 'ukr',
//   'ur-pk': 'urd',
//   'uz-uz': 'uzb',
//   'uz-cyrl-uz': 'uzb_cyrl',
//   'vi-vn': 'vie',
//   'yi-us': 'yid'
// }

export class TesseractService {
  private worker: Tesseract.Worker | null = null

  async getWorker(): Promise<Tesseract.Worker> {
    if (!this.worker) {
      // for now, only support limited languages
      this.worker = await createWorker(['chi_sim', 'chi_tra', 'eng'], undefined, {
        langPath: await this._getLangPath(),
        cachePath: this._getCacheDir(),
        logger: (m) => logger.debug('From worker', m)
      })
    }
    return this.worker
  }

  private async _getLangPath(): Promise<string> {
    const country = await getIpCountry()
    return country.toLowerCase() === 'cn' ? TesseractLangsDownloadUrl.CN : TesseractLangsDownloadUrl.GLOBAL
  }

  private _getCacheDir(): string {
    return path.join(app.getPath('userData'), 'tesseract')
  }

  async dispose(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate()
      this.worker = null
    }
  }
}

export const tesseractService = new TesseractService()
