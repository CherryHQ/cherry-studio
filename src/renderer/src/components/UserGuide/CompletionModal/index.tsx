import assistantBackground from '@renderer/assets/images/guide/assistant_background.png'
import cherryai3d from '@renderer/assets/images/guide/cherryai_3d.png'
import { useSystemAssistantPresets } from '@renderer/pages/store/assistants/presets'
import { createAssistantFromAgent } from '@renderer/services/AssistantService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { showCompletionModal } from '@renderer/store/onboarding'
import type { AssistantPreset } from '@renderer/types'
import { Compass } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import AssistantCard from './AssistantCard'
import Confetti from './Confetti'
import {
  AssistantsGrid,
  AssistantsSection,
  CherryImage,
  ExploreButton,
  ModalContainer,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalSubtitle,
  ModalTitle
} from './styles'

const CompletionModal: FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const presets = useSystemAssistantPresets()

  const { taskStatus, completionModalShown, guidePageCompleted } = useAppSelector((state) => state.onboarding)

  const [isVisible, setIsVisible] = useState(false)
  const [showConfetti, setShowConfetti] = useState(false)

  const allTasksCompleted = useMemo(
    () => taskStatus.useFreeModel && taskStatus.configureProvider && taskStatus.sendFirstMessage,
    [taskStatus]
  )

  // Show modal when all tasks completed and not shown before
  useEffect(() => {
    if (allTasksCompleted && !completionModalShown && guidePageCompleted) {
      setShowConfetti(true)
      setIsVisible(true)
      dispatch(showCompletionModal())
    }
  }, [allTasksCompleted, completionModalShown, guidePageCompleted, dispatch])

  // Get recommended assistants (first 6 from presets)
  const recommendedAssistants = useMemo(() => presets.slice(0, 6), [presets])

  const handleAssistantClick = useCallback(
    (assistant: AssistantPreset) => {
      createAssistantFromAgent(assistant)
      setIsVisible(false)
      navigate('/')
    },
    [navigate]
  )

  const handleExplore = useCallback(() => {
    setIsVisible(false)
    navigate('/store')
  }, [navigate])

  const handleClose = useCallback(() => {
    setIsVisible(false)
  }, [])

  if (!isVisible) {
    return null
  }

  return (
    <>
      {showConfetti && <Confetti duration={2000} />}
      <ModalOverlay onClick={handleClose}>
        <ModalContainer $backgroundImage={assistantBackground} onClick={(e) => e.stopPropagation()}>
          <ModalHeader>
            <CherryImage src={cherryai3d} alt="Cherry AI" />
            <ModalTitle>{t('userGuide.completionModal.title')}</ModalTitle>
            <ModalSubtitle>{t('userGuide.completionModal.subtitle')}</ModalSubtitle>
          </ModalHeader>

          {recommendedAssistants.length > 0 && (
            <AssistantsSection>
              <AssistantsGrid>
                {recommendedAssistants.map((assistant) => (
                  <AssistantCard
                    key={assistant.id}
                    assistant={assistant}
                    onClick={() => handleAssistantClick(assistant)}
                  />
                ))}
              </AssistantsGrid>
            </AssistantsSection>
          )}

          <ModalFooter>
            <ExploreButton onClick={handleExplore}>
              <Compass size={16} />
              {t('userGuide.completionModal.exploreMore')}
            </ExploreButton>
          </ModalFooter>
        </ModalContainer>
      </ModalOverlay>
    </>
  )
}

export default CompletionModal
