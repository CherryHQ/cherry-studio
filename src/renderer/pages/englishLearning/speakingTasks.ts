import type { LearningUnit, PracticeMode } from '@shared/data/types/englishLearning'

export type SpeakingCefr = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'
export type SpeakingTaskKey =
  | 'scenario_advanced'
  | 'scenario_beginner'
  | 'scenario_independent'
  | 'scenario_intermediate'
  | 'shadowing_advanced'
  | 'shadowing_beginner'
  | 'shadowing_independent'
  | 'shadowing_intermediate'
  | 'spoken_recall_advanced'
  | 'spoken_recall_beginner'
  | 'spoken_recall_independent'
  | 'spoken_recall_intermediate'

const CEFR_LEVELS = new Set<SpeakingCefr>(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])

export const speakingTaskTranslationKeys: Record<SpeakingTaskKey, string> = {
  scenario_advanced: 'english_learning.speaking.tasks.scenario_advanced',
  scenario_beginner: 'english_learning.speaking.tasks.scenario_beginner',
  scenario_independent: 'english_learning.speaking.tasks.scenario_independent',
  scenario_intermediate: 'english_learning.speaking.tasks.scenario_intermediate',
  shadowing_advanced: 'english_learning.speaking.tasks.shadowing_advanced',
  shadowing_beginner: 'english_learning.speaking.tasks.shadowing_beginner',
  shadowing_independent: 'english_learning.speaking.tasks.shadowing_independent',
  shadowing_intermediate: 'english_learning.speaking.tasks.shadowing_intermediate',
  spoken_recall_advanced: 'english_learning.speaking.tasks.spoken_recall_advanced',
  spoken_recall_beginner: 'english_learning.speaking.tasks.spoken_recall_beginner',
  spoken_recall_independent: 'english_learning.speaking.tasks.spoken_recall_independent',
  spoken_recall_intermediate: 'english_learning.speaking.tasks.spoken_recall_intermediate'
}

export function normalizeCefr(cefr?: string | null): SpeakingCefr {
  const normalized = cefr?.trim().toUpperCase()
  return normalized && CEFR_LEVELS.has(normalized as SpeakingCefr) ? (normalized as SpeakingCefr) : 'B1'
}

export function getCardSpeakingTaskKey(
  mode: PracticeMode,
  unit: Pick<LearningUnit, 'cefr' | 'english' | 'meaning'>
): SpeakingTaskKey {
  const cefr = normalizeCefr(unit.cefr)
  if (mode === 'shadowing') {
    if (cefr === 'A1' || cefr === 'A2') return 'shadowing_beginner'
    if (cefr === 'B1') return 'shadowing_intermediate'
    if (cefr === 'B2') return 'shadowing_independent'
    return 'shadowing_advanced'
  }

  if (mode === 'spoken_recall') {
    if (cefr === 'A1' || cefr === 'A2') return 'spoken_recall_beginner'
    if (cefr === 'B1') return 'spoken_recall_intermediate'
    if (cefr === 'B2') return 'spoken_recall_independent'
    return 'spoken_recall_advanced'
  }

  if (cefr === 'A1' || cefr === 'A2') return 'scenario_beginner'
  if (cefr === 'B1') return 'scenario_intermediate'
  if (cefr === 'B2') return 'scenario_independent'
  return 'scenario_advanced'
}

export function buildCardSpeakingTask(
  mode: PracticeMode,
  unit: Pick<LearningUnit, 'cefr' | 'english' | 'meaning'>
): string {
  switch (getCardSpeakingTaskKey(mode, unit)) {
    case 'shadowing_beginner':
      return 'Listen and repeat the target sentence clearly. Focus on accurate sounds and word boundaries.'
    case 'shadowing_intermediate':
      return 'Repeat the sentence, then say it once more naturally without reading every word.'
    case 'shadowing_independent':
      return 'Shadow the sentence, then paraphrase it in a nearby real-life context.'
    case 'shadowing_advanced':
      return 'Shadow the sentence, then transform it into a natural, idiomatic sentence for a different context.'
    case 'spoken_recall_beginner':
      return 'Say the English sentence from the meaning. Keep it simple and accurate.'
    case 'spoken_recall_intermediate':
      return 'Recall the sentence, then briefly retell the idea in your own words.'
    case 'spoken_recall_independent':
      return 'Recall the expression and use it in a realistic short response.'
    case 'spoken_recall_advanced':
      return 'Recall the expression, then use it to express a nuanced opinion or argument.'
    case 'scenario_beginner':
      return 'Ask short, concrete questions and keep answers simple.'
    case 'scenario_intermediate':
      return 'Ask the learner to retell or describe a familiar situation using the target cards.'
    case 'scenario_independent':
      return 'Ask scenario-transfer questions that require flexible use of the target cards.'
    case 'scenario_advanced':
      return 'Ask opinion, nuance, and counterargument questions that push native-like expression.'
  }
}

export function buildCardTargetLine(unit: Pick<LearningUnit, 'cefr' | 'english' | 'meaning'>): string {
  return `[${normalizeCefr(unit.cefr)}] ${unit.english} (${unit.meaning})`
}
