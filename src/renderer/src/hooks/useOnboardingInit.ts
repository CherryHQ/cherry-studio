import { loggerService } from '@logger'
import { useOnboarding } from '@renderer/components/Onboarding'
import { selectApplicableGuides } from '@renderer/config/onboarding'
import type { GuideStep, VersionGuide } from '@renderer/types/onboarding'
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

const logger = loggerService.withContext('useOnboardingInit')

/**
 * Wait for an element to appear in the DOM using MutationObserver
 */
function waitForElement(selector: string, timeout = 3000): Promise<Element | null> {
  return new Promise((resolve) => {
    const el = document.querySelector(selector)
    if (el) return resolve(el)

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector)
      if (el) {
        observer.disconnect()
        resolve(el)
      }
    })

    observer.observe(document.body, { childList: true, subtree: true })

    setTimeout(() => {
      observer.disconnect()
      resolve(null)
    }, timeout)
  })
}

/**
 * Get the first element selector from guide steps
 */
function getFirstElementSelector(guide: VersionGuide): string | null {
  for (const step of guide.steps) {
    if (typeof step.element === 'string') {
      return step.element
    }
    if (typeof step.element === 'function') {
      // For function selectors, use a known fallback
      return '.home-navbar'
    }
  }
  return null
}

/**
 * Check if a step has an element selector (not a modal-style step)
 */
function stepHasElement(step: GuideStep): boolean {
  return step.element !== undefined
}

/**
 * Hook to initialize and trigger onboarding guides
 * Should be called in a component that renders after app is ready
 */
export function useOnboardingInit() {
  const location = useLocation()
  const { startGuide, isGuideActive, completedOnboardingVersion, completedFeatureGuides, onboardingSkipped } =
    useOnboarding()
  const [hasTriggered, setHasTriggered] = useState(false)
  const [appVersion, setAppVersion] = useState<string | null>(null)

  useEffect(() => {
    window.api.getAppInfo().then((info) => {
      setAppVersion(info.version)
    })
  }, [])

  // Trigger onboarding after first target element is ready
  useEffect(() => {
    if (!appVersion || hasTriggered || isGuideActive) return

    if (location.pathname !== '/') return

    let cancelled = false

    const triggerOnboarding = async () => {
      const result = selectApplicableGuides(
        appVersion,
        completedOnboardingVersion,
        completedFeatureGuides,
        onboardingSkipped
      )

      if (result.guides.length === 0) return

      const guide = result.guides[0]
      const firstSelector = getFirstElementSelector(guide)

      // Wait for first target element if guide has element-based steps
      if (firstSelector && guide.steps.some(stepHasElement)) {
        const element = await waitForElement(firstSelector)
        if (cancelled) return
        if (!element) {
          logger.warn('First onboarding element not found', { selector: firstSelector })
          return
        }
      }

      if (cancelled) return

      logger.info('Starting onboarding guide', {
        version: guide.version,
        type: guide.type,
        isNewUser: result.isNewUser
      })
      startGuide(guide)
      setHasTriggered(true)
    }

    triggerOnboarding()

    return () => {
      cancelled = true
    }
  }, [
    appVersion,
    hasTriggered,
    isGuideActive,
    location.pathname,
    completedOnboardingVersion,
    completedFeatureGuides,
    onboardingSkipped,
    startGuide
  ])
}
