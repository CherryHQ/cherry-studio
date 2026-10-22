/**
 * Cosmetic rules that hide the promoted slots of search-result pages.
 *
 * These are deliberately separate from the EasyList engine: the engine blocks
 * ad *requests* everywhere, while this list only removes the visual blocks a
 * search engine sells as "推广" / "广告" / "Sponsored". Keeping them apart lets
 * the settings page offer the second switch on its own.
 *
 * Hosts are matched exactly and result pages additionally require their search
 * path, so `mail.google.com` or `tieba.baidu.com` are left untouched. Selectors
 * stay close to the containers the engines mark themselves: hiding an organic
 * result is worse than showing an ad.
 */

interface SearchAdRule {
  hosts: string[]
  /** Optional path guard; search result pages do not always live at the root. */
  path?: RegExp
  css: string
}

const SEARCH_AD_RULES: SearchAdRule[] = [
  {
    hosts: ['www.baidu.com', 'baidu.com', 'm.baidu.com'],
    path: /^\/s/,
    css: `
      #content_left > .result[data-tuiguang],
      #content_left > .result-op[data-tuiguang],
      #content_left > .c-container[data-tuiguang],
      #content_left > div[data-tuiguang],
      .ec-tuiguang,
      .ec_tuiguang,
      .c-result[data-tuiguang],
      #search-union-ad,
      #search_bottomad {
        display: none !important;
      }
    `
  },
  {
    hosts: [
      'www.google.com',
      'www.google.com.hk',
      'www.google.co.jp',
      'www.google.co.uk',
      'www.google.com.tw',
      'www.google.ca',
      'www.google.com.au',
      'www.google.de',
      'www.google.fr'
    ],
    path: /^\/search/,
    css: `
      #tads,
      #tadsb,
      #bottomads,
      .commercial-unit-desktop-top,
      .commercial-unit-desktop-rhs,
      [data-text-ad],
      #rhs .commercial-unit-desktop-rhs {
        display: none !important;
      }
    `
  },
  {
    hosts: ['www.bing.com', 'cn.bing.com', 'bing.com'],
    path: /^\/search/,
    css: `
      #bads,
      #b_results > li.b_ad,
      #b_results > li.b_adLastChild,
      .b_adLastChild {
        display: none !important;
      }
    `
  },
  {
    hosts: ['www.sogou.com', 'sogou.com'],
    path: /^\/(web|sogou)/,
    css: `
      #right .pt,
      .vrwrap[data-vr='tg'],
      #main .results > .rb,
      .ec-tuiguang {
        display: none !important;
      }
    `
  },
  {
    hosts: ['www.so.com', 'so.com'],
    path: /^\/s/,
    css: `
      .res-list[data-tuiguang],
      #e_idea_pp,
      #e_idea_left,
      .e_idea {
        display: none !important;
      }
    `
  },
  {
    hosts: ['m.sm.cn', 'quark.sm.cn', 'so.m.sm.cn'],
    css: `
      .result.ad,
      .ec_ad,
      .c-ad {
        display: none !important;
      }
    `
  },
  {
    hosts: ['duckduckgo.com', 'html.duckduckgo.com', 'lite.duckduckgo.com'],
    css: `
      .result--ad,
      #ads,
      .results--ads {
        display: none !important;
      }
    `
  },
  {
    hosts: ['yandex.com', 'www.yandex.com', 'yandex.ru', 'www.yandex.ru'],
    path: /^\/search/,
    css: `
      .serp-adv,
      .serp-item[data-fast-name='ads'] {
        display: none !important;
      }
    `
  }
]

function parseUrl(rawUrl: string): URL | undefined {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}

/** Returns the stylesheet for this page when it is a supported search result page. */
export function getSearchAdsCss(rawUrl: string): string | undefined {
  const url = parseUrl(rawUrl)
  if (!url) return undefined
  const rule = SEARCH_AD_RULES.find(
    (candidate) => candidate.hosts.includes(url.hostname) && (!candidate.path || candidate.path.test(url.pathname))
  )
  return rule?.css
}

export function isSearchResultPage(rawUrl: string): boolean {
  return getSearchAdsCss(rawUrl) !== undefined
}

/** Exposed for tests. */
export const SEARCH_AD_HOSTS = SEARCH_AD_RULES.flatMap((rule) => rule.hosts)
