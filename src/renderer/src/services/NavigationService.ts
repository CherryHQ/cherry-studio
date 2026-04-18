import type { UseNavigateResult } from '@tanstack/react-router'

import { Signal } from './Signal'

// Tab 导航服务 - 用于在非 React 组件中进行路由导航
interface INavigationService {
  navigate: UseNavigateResult<string> | null
  setNavigate: (navigateFunc: UseNavigateResult<string>) => void
  readonly ready: Signal<void>
}

const NavigationService: INavigationService = {
  navigate: null,
  ready: new Signal<void>(),

  setNavigate: (navigateFunc: UseNavigateResult<string>): void => {
    NavigationService.navigate = navigateFunc
    window.navigate = NavigationService.navigate
    NavigationService.ready.resolve()
  }
}

export default NavigationService
