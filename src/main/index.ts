import { electronApp, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow } from 'electron'
import installExtension, { REDUX_DEVTOOLS } from 'electron-devtools-installer'

import { registerIpc } from './ipc'
import { AgentMultiplexerService } from './services/AgentMultiplexerService';
import { BrowserViewManagerService } from './services/BrowserViewManagerService';
import { HuggingFaceService } from './services/HuggingFaceService';
import { GitHubService } from './services/GitHubService'; // Added
import { updateUserDataPath } from './utils/upgrade'
import { createMainWindow } from './window'

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  await updateUserDataPath()

  // Set app user model id for windows
  electronApp.setAppUserModelId(import.meta.env.VITE_MAIN_BUNDLE_ID || 'com.kangfenmao.CherryStudio')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })

  const mainWindow = createMainWindow()

  // Initialize the Agent Multiplexer Service
  const agentMultiplexerService = new AgentMultiplexerService(); // Add your Ollama base URL if not default, e.g., 'http://host.docker.internal:11434'
  agentMultiplexerService.startProcessingLoop(); // Start its processing loop

  const browserViewManagerService = new BrowserViewManagerService();

  // TODO: Retrieve actual Hugging Face API key from a secure config or environment variable
  const HUGGING_FACE_API_KEY = process.env.HUGGING_FACE_API_KEY || undefined;
  const huggingFaceService = new HuggingFaceService(HUGGING_FACE_API_KEY);

  // TODO: Retrieve actual GitHub API key from a secure config or environment variable
  const GITHUB_API_KEY = process.env.GITHUB_API_KEY || undefined;
  const githubService = new GitHubService(GITHUB_API_KEY); // Added

  registerIpc(mainWindow, app, agentMultiplexerService, browserViewManagerService, huggingFaceService, githubService) // Added githubService

  if (process.env.NODE_ENV === 'development') {
    installExtension(REDUX_DEVTOOLS)
      .then((name) => console.log(`Added Extension:  ${name}`))
      .catch((err) => console.log('An error occurred: ', err))
  }
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.
