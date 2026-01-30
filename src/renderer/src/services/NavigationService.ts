import type { UseNavigateResult } from '@tanstack/react-router'

// Tab 导航服务 - 用于在非 React 组件中进行路由导航
interface INavigationService {
  navigate: UseNavigateResult<string> | null
  setNavigate: (navigateFunc: UseNavigateResult<string>) => void
}

const NavigationService: INavigationService = {
  navigate: null,

  setNavigate: (navigateFunc: UseNavigateResult<string>): void => {
    NavigationService.navigate = navigateFunc
    window.navigate = NavigationService.navigate
  }
}

export default NavigationService
