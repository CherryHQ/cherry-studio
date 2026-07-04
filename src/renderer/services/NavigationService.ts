import type { UseNavigateResult } from '@tanstack/react-router'

/**
 * Bridges the router's `navigate` to non-React callers (e.g. settings deep-links).
 * Holds the navigate fn set once per window by the app shell, so it is a stateful
 * singleton capability (naming-conventions §5.2).
 */
class NavigationService {
  navigate: UseNavigateResult<string> | null = null

  setNavigate(navigateFunc: UseNavigateResult<string>): void {
    this.navigate = navigateFunc
  }
}

export const navigationService = new NavigationService()
