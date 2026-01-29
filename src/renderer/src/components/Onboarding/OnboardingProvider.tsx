import 'driver.js/dist/driver.css'
import './styles/driver-theme.css'

import { loggerService } from '@logger'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useProvider } from '@renderer/hooks/useProvider'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { completeFeatureGuide, completeOnboarding, completeTask, skipOnboarding } from '@renderer/store/onboarding'
import type { GuideStep, UserGuideTaskStatus, VersionGuide } from '@renderer/types/onboarding'
import { type Driver, driver, type DriveStep } from 'driver.js'
import type { FC, PropsWithChildren } from 'react'
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'

const logger = loggerService.withContext('Onboarding')

// Mapping from user guide version to task key
const USER_GUIDE_TASK_MAP: Record<string, keyof UserGuideTaskStatus> = {
  'user-guide-use-free-model': 'useFreeModel',
  'user-guide-configure-provider': 'configureProvider',
  'user-guide-send-message': 'sendFirstMessage'
}

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

  // Process guide-video elements: show skeleton while loading, fade in when ready
  const injectVideos = useCallback(() => {
    const videoContainers = document.querySelectorAll('.guide-video[data-video-light]')
    videoContainers.forEach((container) => {
      // Skip if already processed
      if (container.getAttribute('data-processed')) return
      container.setAttribute('data-processed', 'true')

      const lightUrl = container.getAttribute('data-video-light')
      const darkUrl = container.getAttribute('data-video-dark')
      const videoUrl = theme === 'dark' && darkUrl ? darkUrl : lightUrl

      if (!videoUrl) return

      // Create skeleton placeholder
      const skeleton = document.createElement('div')
      skeleton.className = 'guide-video-skeleton'
      skeleton.innerHTML = `
        <div class="ant-skeleton ant-skeleton-active ant-skeleton-element">
          <span class="ant-skeleton-image"></span>
        </div>
      `
      container.appendChild(skeleton)

      // Create and load video
      const video = document.createElement('video')
      video.src = videoUrl
      video.autoplay = true
      video.loop = true
      video.muted = true
      video.playsInline = true
      video.style.opacity = '0'
      video.style.transition = 'opacity 0.3s ease'
      container.appendChild(video)

      // Show video and hide skeleton when loaded
      video.onloadeddata = () => {
        video.style.opacity = '1'
        skeleton.style.display = 'none'
      }
    })
  }, [theme])

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

      if (wasCompleted) {
        const taskKey = USER_GUIDE_TASK_MAP[guide.version]
        if (taskKey && taskKey !== 'configureProvider' && taskKey !== 'sendFirstMessage') {
          dispatch(completeTask(taskKey))
          logger.info(`Task completed via guide`, { taskKey, guideVersion: guide.version })
        }
      }

      setIsGuideActive(false)
      setCurrentGuide(null)
      guideRef.current = { guide: null, steps: [] }
    },
    [dispatch]
  )

  const createDriverSteps = useCallback(
    (guideSteps: GuideStep[]): DriveStep[] =>
      guideSteps.map((step, index) => {
        const isLastStep = index === guideSteps.length - 1
        return {
          element: resolveElement(step),
          popover: {
            title: t(step.titleKey),
            description: t(step.descriptionKey, step.descriptionInterpolation),
            side: step.side === 'over' ? undefined : step.side,
            align: step.align,
            // Custom button text per step
            nextBtnText: step.nextBtnTextKey ? t(step.nextBtnTextKey) : undefined,
            doneBtnText: isLastStep && step.doneBtnTextKey ? t(step.doneBtnTextKey) : undefined
          }
        }
      }),
    [t]
  )

  const createAndStartDriver = useCallback(
    (fromStepIndex: number) => {
      const { guide, steps: guideSteps } = guideRef.current
      if (!guideSteps.length) return

      const steps = createDriverSteps(guideSteps)
      const popoverClass = guide?.popoverClass || 'cherry-driver-popover'
      const isUserGuide = popoverClass.includes('user-guide-popover')

      // For user guide popovers, use custom button text from the last step
      const lastStep = guideSteps[guideSteps.length - 1]
      const doneBtnText = lastStep?.doneBtnTextKey ? t(lastStep.doneBtnTextKey) : t('onboarding.done')

      const driverInstance = driver({
        animate: true,
        showProgress: !isUserGuide,
        overlayColor: theme === 'dark' ? 'rgba(0, 0, 0, 0.75)' : 'rgba(255, 255, 255, 0.75)',
        stagePadding: 10,
        stageRadius: 8,
        allowClose: true,
        smoothScroll: true,
        progressText: t('onboarding.progress'),
        nextBtnText: t('onboarding.next'),
        prevBtnText: t('onboarding.previous'),
        doneBtnText,
        popoverClass: `${popoverClass} ${theme}`,
        steps,
        onPopoverRender: () => {
          // Inject videos after popover is rendered
          injectVideos()
        },
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
    [theme, t, navigate, createDriverSteps, finishGuide, injectVideos]
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

  const { models: cherryinModels } = useProvider('cherryin')
  const { taskStatus } = useAppSelector((state) => state.onboarding)

  useEffect(() => {
    if (!taskStatus.configureProvider && cherryinModels.length > 0) {
      dispatch(completeTask('configureProvider'))
      logger.info('Task completed via CherryIN models', {
        taskKey: 'configureProvider',
        modelCount: cherryinModels.length
      })
    }
  }, [cherryinModels.length, taskStatus.configureProvider, dispatch])

  useEffect(() => {
    if (taskStatus.sendFirstMessage) return

    const handleMessageSent = () => {
      dispatch(completeTask('sendFirstMessage'))
      logger.info('Task completed via message sent', { taskKey: 'sendFirstMessage' })
    }

    EventEmitter.on(EVENT_NAMES.SEND_MESSAGE, handleMessageSent)
    return () => {
      EventEmitter.off(EVENT_NAMES.SEND_MESSAGE, handleMessageSent)
    }
  }, [taskStatus.sendFirstMessage, dispatch])

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
