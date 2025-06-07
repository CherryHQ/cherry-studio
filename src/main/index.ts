import { electronApp, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow } from 'electron'
import installExtension, { REDUX_DEVTOOLS } from 'electron-devtools-installer'

import { registerIpc } from './ipc'
import { AgentMultiplexerService } from './services/AgentMultiplexerService';
import { BrowserViewManagerService } from './services/BrowserViewManagerService';
import { HuggingFaceService } from './services/HuggingFaceService';
import { GitHubService } from './services/GitHubService';
import { GoogleSearchService } from './services/GoogleSearchService'; // Added
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

  // TODO: Retrieve actual Google API key and CSE ID from a secure config or environment variables
  const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || undefined;
  const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID || undefined;
  const googleSearchService = new GoogleSearchService(GOOGLE_API_KEY, GOOGLE_CSE_ID); // Instantiate GoogleSearchService

  // Initialize the Agent Multiplexer Service
  const browserViewManagerService = new BrowserViewManagerService();
  const GITHUB_API_KEY_FOR_AMS = process.env.GITHUB_API_KEY || undefined;
  const githubServiceForAMS = new GitHubService(GITHUB_API_KEY_FOR_AMS);
  const HUGGING_FACE_API_KEY_FOR_AMS = process.env.HUGGING_FACE_API_KEY || undefined;
  const huggingFaceServiceForAMS = new HuggingFaceService(HUGGING_FACE_API_KEY_FOR_AMS); // Create instance for AMS
  const agentMultiplexerService = new AgentMultiplexerService(
    undefined,
    googleSearchService,
    browserViewManagerService,
    githubServiceForAMS,
    huggingFaceServiceForAMS // Pass HuggingFaceService
  );
  agentMultiplexerService.startProcessingLoop(); // Start its processing loop

  // TODO: Retrieve actual Hugging Face API key from a secure config or environment variable
  // This instance is for IPC handlers if different from the one for AMS, or can be the same.
  const HUGGING_FACE_API_KEY_FOR_IPC = process.env.HUGGING_FACE_API_KEY || undefined;
  const huggingFaceServiceForIPC = huggingFaceServiceForAMS; // Using the same instance for both
  // const huggingFaceService = new HuggingFaceService(HUGGING_FACE_API_KEY); // This would be a separate instance

  // TODO: Retrieve actual GitHub API key from a secure config or environment variable
  const GITHUB_API_KEY_FOR_IPC = process.env.GITHUB_API_KEY || undefined;
  const githubServiceForIPC = githubServiceForAMS;

  registerIpc(mainWindow, app, agentMultiplexerService, browserViewManagerService, huggingFaceServiceForIPC, githubServiceForIPC, googleSearchService)

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
