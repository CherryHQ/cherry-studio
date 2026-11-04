import { caseDefinition } from '../../../../scripts/e2e/regression/cases'
import { test } from '../fixture'
import { switchConversationModel } from '../scenarios/switchConversationModel'

test(...caseDefinition('MP-26'), async ({ app, mainWindow }, testInfo) => {
  await switchConversationModel(app, mainWindow, testInfo)
})
