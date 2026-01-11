import 'driver.js/dist/driver.css'
import './styles/driver-theme.css'

import { loggerService } from '@logger'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { completeFeatureGuide, completeOnboarding, skipOnboarding } from '@renderer/store/onboarding'
import type { GuideStep, VersionGuide } from '@renderer/types/onboarding'
import { type Driver, driver, type DriveStep } from 'driver.js'
import type { FC, PropsWithChildren } from 'react'
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'

const logger = loggerService.withContext('Onboarding')

interface OnboardingContextType {
  startGuide: (guide: VersionGuide) => void
  skipGuide: () => void
  isGuideActive: boolean
  currentGuide: VersionGuide | null
  completedOnboardingVersion: string | null
  completedFeatureGuides: string[]
  onboardingSkipped: boolean
}

const OnboardingContext = createContext<OnboardingContextType>({
  startGuide: () => {},
  skipGuide: () => {},
  isGuideActive: false,
  currentGuide: null,
  completedOnboardingVersion: null,
  completedFeatureGuides: [],
  onboardingSkipped: false
})

function resolveElement(step: GuideStep): Element | string | undefined {
  if (!step.element) return undefined
  if (typeof step.element === 'function') {
    return step.element() ?? undefined
  }
  return step.element
}

function isOnRoute(currentPath: string, targetPath: string): boolean {
  // Special case for root path - must match exactly
  if (targetPath === '/') {
    return currentPath === '/'
  }
  return currentPath === targetPath || currentPath.startsWith(targetPath + '/')
}

export const OnboardingProvider: FC<PropsWithChildren> = ({ children }) => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const location = useLocation()
  const navigate = useNavigate()

  const [isGuideActive, setIsGuideActive] = useState(false)
  const [currentGuide, setCurrentGuide] = useState<VersionGuide | null>(null)

  const driverRef = useRef<Driver | null>(null)
  const guideRef = useRef<{ guide: VersionGuide | null; steps: GuideStep[] }>({ guide: null, steps: [] })
  const pathRef = useRef(location.pathname)
  const navigatingRef = useRef(false)

  // Keep pathRef in sync
  pathRef.current = location.pathname

  const { completedOnboardingVersion, completedFeatureGuides, onboardingSkipped } = useAppSelector(
    (state) => state.onboarding
  )

  const finishGuide = useCallback(
    (wasCompleted: boolean) => {
      const guide = guideRef.current.guide
      if (!guide) return

      const action = wasCompleted ? 'completed' : 'skipped'
      logger.info(`Guide ${action}`, { version: guide.version, type: guide.type })

      if (guide.type === 'onboarding') {
        dispatch(wasCompleted ? completeOnboarding(guide.version) : skipOnboarding(guide.version))
      } else {
        dispatch(completeFeatureGuide(guide.version))
      }

      setIsGuideActive(false)
      setCurrentGuide(null)
      guideRef.current = { guide: null, steps: [] }
    },
    [dispatch]
  )

  const createDriverSteps = useCallback(
    (guideSteps: GuideStep[]): DriveStep[] =>
      guideSteps.map((step) => ({
        element: resolveElement(step),
        popover: {
          title: t(step.titleKey),
          description: t(step.descriptionKey),
          side: step.side === 'over' ? undefined : step.side,
          align: step.align
        }
      })),
    [t]
  )

  const createAndStartDriver = useCallback(
    (fromStepIndex: number) => {
      const { steps: guideSteps } = guideRef.current
      if (!guideSteps.length) return

      const steps = createDriverSteps(guideSteps)

      const driverInstance = driver({
        animate: true,
        showProgress: true,
        overlayColor: theme === 'dark' ? 'rgba(0, 0, 0, 0.75)' : 'rgba(255, 255, 255, 0.75)',
        stagePadding: 10,
        stageRadius: 8,
        allowClose: true,
        smoothScroll: true,
        progressText: t('onboarding.progress'),
        nextBtnText: t('onboarding.next'),
        prevBtnText: t('onboarding.previous'),
        doneBtnText: t('onboarding.done'),
        popoverClass: `cherry-driver-popover ${theme}`,
        steps,
        onHighlightStarted: () => {
          // Skip if we just navigated (waiting for re-drive)
          if (navigatingRef.current) return

          const stepIndex = driverRef.current?.getActiveIndex() ?? 0
          const guideStep = guideRef.current.steps[stepIndex]
          const targetPath = guideStep?.navigateTo

          if (!targetPath || isOnRoute(pathRef.current, targetPath)) return

          logger.info('Navigating to', { route: targetPath, stepId: guideStep.id })
          navigatingRef.current = true
          navigate(targetPath)

          // After navigation, re-drive from same step to re-resolve elements
          setTimeout(() => {
            navigatingRef.current = false
            driverRef.current?.drive(stepIndex)
          }, 200)
        },
        onDestroyStarted: () => {
          if (navigatingRef.current) return

          const wasCompleted = driverRef.current?.isLastStep() ?? false
          finishGuide(wasCompleted)
          driverRef.current?.destroy()
        }
      })

      driverRef.current = driverInstance
      driverInstance.drive(fromStepIndex)
    },
    [theme, t, navigate, createDriverSteps, finishGuide]
  )

  const startGuide = useCallback(
    (guide: VersionGuide) => {
      if (isGuideActive) {
        logger.warn('Guide already active, ignoring request')
        return
      }

      logger.info('Starting guide', { version: guide.version, type: guide.type })

      setCurrentGuide(guide)
      guideRef.current = { guide, steps: guide.steps }
      setIsGuideActive(true)

      createAndStartDriver(0)
    },
    [isGuideActive, createAndStartDriver]
  )

  const skipGuide = useCallback(() => {
    if (driverRef.current) {
      driverRef.current.destroy()
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (driverRef.current) {
        driverRef.current.destroy()
      }
    }
  }, [])

  const contextValue = useMemo(
    () => ({
      startGuide,
      skipGuide,
      isGuideActive,
      currentGuide,
      completedOnboardingVersion,
      completedFeatureGuides,
      onboardingSkipped
    }),
    [
      startGuide,
      skipGuide,
      isGuideActive,
      currentGuide,
      completedOnboardingVersion,
      completedFeatureGuides,
      onboardingSkipped
    ]
  )

  return <OnboardingContext value={contextValue}>{children}</OnboardingContext>
}

export const useOnboarding = () => use(OnboardingContext)
