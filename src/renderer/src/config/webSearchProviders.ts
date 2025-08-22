import { WebSearchProvider, WebSearchProviderId } from '@renderer/types'

type WebSearchProviderConfig = {
  websites: {
    official: string
    apiKey?: string
  }
}

export const WEB_SEARCH_PROVIDER_CONFIG: Record<WebSearchProviderId, WebSearchProviderConfig> = {
  zhipu: {
    websites: {
      official: 'https://docs.bigmodel.cn/cn/guide/tools/web-search',
      apiKey: 'https://zhipuaishengchan.datasink.sensorsdata.cn/t/yv'
    }
  },
  tavily: {
    websites: {
      official: 'https://tavily.com',
      apiKey: 'https://app.tavily.com/home'
    }
  },
  searxng: {
    websites: {
      official: 'https://docs.searxng.org'
    }
  },
  exa: {
    websites: {
      official: 'https://exa.ai',
      apiKey: 'https://dashboard.exa.ai/api-keys'
    }
  },
  bocha: {
    websites: {
      official: 'https://bochaai.com',
      apiKey: 'https://open.bochaai.com/overview'
    }
  },
  'local-google': {
    websites: {
      official: 'https://www.google.com'
    }
  },
  'local-bing': {
    websites: {
      official: 'https://www.bing.com'
    }
  },
  'local-baidu': {
    websites: {
      official: 'https://www.baidu.com'
    }
  }
}

export const WEB_SEARCH_PROVIDERS: WebSearchProvider[] = [
  {
    id: 'zhipu',
    name: 'Zhipu',
    apiHost: 'https://open.bigmodel.cn/api/paas/v4/web_search',
    apiKey: ''
  },
  {
    id: 'tavily',
    name: 'Tavily',
    apiHost: 'https://api.tavily.com',
    apiKey: ''
  },
  {
    id: 'searxng',
    name: 'Searxng',
    apiHost: '',
    basicAuthUsername: '',
    basicAuthPassword: ''
  },
  {
    id: 'exa',
    name: 'Exa',
    apiHost: 'https://api.exa.ai',
    apiKey: ''
  },
  {
    id: 'bocha',
    name: 'Bocha',
    apiHost: 'https://api.bochaai.com',
    apiKey: ''
  },
  {
    id: 'local-google',
    name: 'Google',
    url: 'https://www.google.com/search?q=%s'
  },
  {
    id: 'local-bing',
    name: 'Bing',
    url: 'https://cn.bing.com/search?q=%s&ensearch=1'
  },
  {
    id: 'local-baidu',
    name: 'Baidu',
    url: 'https://www.baidu.com/s?wd=%s'
  }
] as const
