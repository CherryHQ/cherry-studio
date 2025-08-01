import i18n from '@renderer/i18n'
import { CherryStoreType } from '@renderer/types/cherryStore'
import { lazy } from 'react'

export const ROUTERS = [
  {
    id: CherryStoreType.ASSISTANT,
    title: i18n.t('assistants.title'),
    path: CherryStoreType.ASSISTANT,
    component: lazy(() => import('./pages/agents/AgentsPage')),
    hasSidebar: false, // 目前都没有侧边栏
    items: [{ id: 'all', name: `All ${i18n.t('assistants.title')}` }] // 预设 "All" 子分类
  },
  {
    id: CherryStoreType.MINI_APP,
    title: i18n.t('minapp.title'),
    path: CherryStoreType.MINI_APP,
    component: lazy(() => import('./pages/minapps/MinAppsPage')),
    hasSidebar: false, // 目前都没有侧边栏
    items: [{ id: 'all', name: `All ${i18n.t('minapp.title')}` }] // 预设 "All" 子分类
  }
  //   {
  //     id: CherryStoreType.TRANSLATE,
  //     title: i18n.t('translate.title'),
  //     path: 'translate',
  //     component: lazy(() => import('../translate/TranslatePage'))
  //   },
  //   {
  //     id: CherryStoreType.FILES,
  //     title: i18n.t('files.title'),
  //     path: 'files',
  //     component: lazy(() => import('../files/FilesPage'))
  //   },
  //   {
  //     id: CherryStoreType.PAINTINGS,
  //     title: i18n.t('paintings.title'),
  //     path: 'paintings/*',
  //     isPrefix: true,
  //     component: lazy(() => import('../paintings/PaintingsRoutePage'))
  //   }
  //   {
  //     id: CherryStoreType.MCP_SERVER,
  //     title: i18n.t('common.mcp'),
  //     path: 'mcp-servers/*',
  //     isPrefix: true,
  //     component: lazy(() => import('../mcp-servers'))
  //   }
]

export const ROUTERS_MAP = new Map(ROUTERS.map((router) => [router.id, router]))
