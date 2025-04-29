import { NavigateFunction } from 'react-router-dom'

interface INavigationService {
  navigate: NavigateFunction | null
  setNavigate: (navigateFunc: NavigateFunction) => void
}

const NavigationService: INavigationService = {
  navigate: null,

  setNavigate: (navigateFunc: NavigateFunction): void => {
    NavigationService.navigate = navigateFunc
    window.navigate = NavigationService.navigate
  }
}

export default NavigationService
