import * as fs from 'node:fs'
import * as path from 'node:path'

const REPO_ROOT = path.resolve(__dirname, '..')

type WritableStream = Pick<typeof process.stdout, 'write'>

export interface CustomizationContract {
  file: string
  markers: string[]
}

export interface CustomizationContractFailure {
  file: string
  missing: 'file' | string
}

export const ENGLISH_LEARNING_CONTRACTS: CustomizationContract[] = [
  {
    file: 'src/main/core/application/serviceRegistry.ts',
    markers: ['EnglishLearningService', 'EnglishLearningReminderService', 'ObsidianLearningSyncService']
  },
  {
    file: 'src/main/data/api/handlers/apiHandlers.ts',
    markers: ["from './englishLearning'", '...englishLearningHandlers']
  },
  {
    file: 'src/main/ipc/handlers/ipcHandlers.ts',
    markers: ["from './englishLearning'", "from './speech'", '...englishLearningHandlers', '...speechHandlers']
  },
  {
    file: 'src/main/data/services/TranslateHistoryService.ts',
    markers: ['englishLearningImportService']
  },
  {
    file: 'src/main/data/services/TemporaryChatService.ts',
    markers: ['registerSelectionActionBestEffort']
  },
  {
    file: 'src/renderer/windows/selection/action/components/ActionTranslate.tsx',
    markers: ['useTranslateHistory', 'addHistory']
  },
  {
    file: 'src/renderer/windows/selection/action/components/ActionGeneral.tsx',
    markers: ['/english-learning/selection-actions/import']
  },
  {
    file: 'src/renderer/utils/sidebar.ts',
    markers: ["id: 'english_learning'", "routePrefix: '/app/english-learning'"]
  },
  {
    file: 'src/renderer/pages/launchpad/LaunchpadPage.tsx',
    markers: ['english_learning']
  },
  {
    file: 'src/main/services/mainWindowNavigation.ts',
    markers: ["'/app/english-learning'"]
  },
  {
    file: 'src/shared/data/preference/preferenceTypes.ts',
    markers: ["'english_learning'"]
  },
  {
    file: 'src/shared/data/cache/cacheSchemas.ts',
    markers: ["'feature.english_learning.extraction_policy_version'"]
  },
  {
    file: 'src/shared/data/types/englishLearning.ts',
    markers: ["'translation'", "'selection_refine'", "'selection_action'"]
  },
  {
    file: 'src/main/features/englishLearning/EnglishLearningService.ts',
    markers: ['upgradeExtractionPolicy', 'importSelectionActionBatch']
  },
  {
    file: 'src/renderer/routes/app/english-learning.tsx',
    markers: ["createFileRoute('/app/english-learning')"]
  }
]

export function checkEnglishLearningCustomization(
  root = REPO_ROOT,
  contracts: CustomizationContract[] = ENGLISH_LEARNING_CONTRACTS
): CustomizationContractFailure[] {
  const failures: CustomizationContractFailure[] = []

  for (const contract of contracts) {
    const filePath = path.join(root, contract.file)
    if (!fs.existsSync(filePath)) {
      failures.push({ file: contract.file, missing: 'file' })
      continue
    }

    const content = fs.readFileSync(filePath, 'utf8')
    for (const marker of contract.markers) {
      if (!content.includes(marker)) failures.push({ file: contract.file, missing: marker })
    }
  }

  return failures
}

export function runCli(
  root = REPO_ROOT,
  stdout: WritableStream = process.stdout,
  stderr: WritableStream = process.stderr
): number {
  const failures = checkEnglishLearningCustomization(root)
  if (failures.length === 0) {
    stdout.write(`English-learning customization contracts passed (${ENGLISH_LEARNING_CONTRACTS.length} seams).\n`)
    return 0
  }

  stderr.write('English-learning customization contracts failed:\n')
  for (const failure of failures) {
    const detail = failure.missing === 'file' ? 'file is missing' : `missing marker: ${failure.missing}`
    stderr.write(`- ${failure.file}: ${detail}\n`)
  }
  stderr.write('Adapt the customization to the current upstream seam, then update this contract intentionally.\n')
  return 1
}

if (require.main === module) {
  process.exitCode = runCli()
}
