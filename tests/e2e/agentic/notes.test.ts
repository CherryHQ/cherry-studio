import { test } from '@e2e-dev/web'
import { expect, unique } from 'e2e'

import { data, openApp, phase } from './helpers'

test(`a note remains intact after navigation and restart (${phase})`, async ({ app, agent, browser, screen }) => {
  await openApp(app, browser)
  const title = `Agentic note ${data.marker}`
  const content = `Persist this exact note: ${data.marker}`
  if (phase === 'write') {
    await agent.act(
      'Open Launchpad, then Notes. Create a new note, rename it to {title}, and press Enter to commit the title. Do not type in the document editor yet.',
      { params: { title: unique(title) }, timeout: 120_000 }
    )
    await expect(screen.getByRole('treeitem', { name: title, exact: true })).toBeVisible()
    await agent.act("Enter {content} in the note document textbox named Write '/' for commands.", {
      params: { content: unique(content) },
      timeout: 90_000
    })
    await expect(browser.locator('[data-ui~="notes.editor"][data-note-id]:visible')).toContainText(content)
    await agent.act('Switch to Chat. Then return to Notes using its tab or Launchpad. Open the note titled {title}.', {
      params: { title: unique(title) },
      timeout: 90_000
    })
  } else {
    await agent.act('Open the existing note titled {title} in Notes. Do not create or edit any notes.', {
      params: { title: unique(title) },
      timeout: 90_000
    })
  }
  await expect(browser.locator('[data-ui~="notes.editor"][data-note-id]:visible')).toContainText(content)
  await app.screenshot(`note-${phase}`)
})
