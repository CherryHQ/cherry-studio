import i18n from '@renderer/i18n'
import { CherryStoreType } from '@renderer/types/cherryStore'
import { lazy } from 'react'

export const discoverRouters = [
  {
    id: CherryStoreType.ASSISTANT,
    title: i18n.t('assistants.title'),
    path: 'assistant',
    component: lazy(() => import('../agents/AgentsPage'))
  },
  {
    id: CherryStoreType.MINI_APP,
    title: i18n.t('minapp.title'),
    path: 'mini-app',
    component: lazy(() => import('../apps/AppsPage'))
  },
  {
    id: CherryStoreType.TRANSLATE,
    title: i18n.t('translate.title'),
    path: 'translate',
    component: lazy(() => import('../translate/TranslatePage'))
  },
  {
    id: CherryStoreType.FILES,
    title: i18n.t('files.title'),
    path: 'files',
    component: lazy(() => import('../files/FilesPage'))
  },
  {
    id: CherryStoreType.PAINTINGS,
    title: i18n.t('paintings.title'),
    path: 'paintings/*',
    isPrefix: true,
    component: lazy(() => import('../paintings/PaintingsRoutePage'))
  },
  {
    id: CherryStoreType.MCP_SERVER,
    title: i18n.t('common.mcp'),
    path: 'mcp-servers/*',
    isPrefix: true,
    component: lazy(() => import('../mcp-servers'))
  }
]
