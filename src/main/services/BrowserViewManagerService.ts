// src/main/services/BrowserViewManagerService.ts
import { BrowserWindow, BrowserView, Rectangle, session } from 'electron';
import * as path from 'path';

interface ManagedBrowserView {
  view: BrowserView;
  hostWindowId: number;
  id: string; // Could be same as hostWindowId if one view per window, or unique if multiple
}

export class BrowserViewManagerService {
  private views: Map<string, ManagedBrowserView> = new Map(); // Maps a unique ID to a BrowserView instance
  private defaultUserAgent: string = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 SkyscopeAI/1.0';


  constructor() {
    console.log('BrowserViewManagerService: Initialized');
    // Ensure a default session exists and potentially configure it
    session.defaultSession.setUserAgent(this.defaultUserAgent);
  }

  private getHostWindow(windowId?: number): BrowserWindow | null {
    if (windowId === undefined) {
        // If no ID, try to get the currently focused or main window
        let window = BrowserWindow.getFocusedWindow();
        if (!window && BrowserWindow.getAllWindows().length > 0) {
            window = BrowserWindow.getAllWindows()[0]; // Fallback to the first window
        }
        return window;
    }
    return BrowserWindow.fromId(windowId);
  }

  // viewId is used to manage potentially multiple views. For a single view per window, it could be the windowId.
  public createBrowserView(viewId: string, hostWindowId?: number, initialUrl: string = 'about:blank'): string | null {
    const hostWindow = this.getHostWindow(hostWindowId);
    if (!hostWindow) {
      console.error(`BrowserViewManagerService: Host window with ID ${hostWindowId} not found.`);
      return null;
    }

    if (this.views.has(viewId)) {
      console.warn(`BrowserViewManagerService: View with ID ${viewId} already exists. Returning existing view.`);
      // Optionally focus or show the existing view
      const existingManagedView = this.views.get(viewId)!;
      if (!hostWindow.getBrowserViews().includes(existingManagedView.view)) {
          hostWindow.addBrowserView(existingManagedView.view);
      }
      return viewId;
    }

    const view = new BrowserView({
      webPreferences: {
        partition: `persist:bvm_${viewId}`, // Persistent session per viewId
        preload: path.join(__dirname, '../preload/index.js'), // Standard preload
        contextIsolation: true,
        sandbox: true,
        webviewTag: false,
        nodeIntegration: false,
        devTools: process.env.NODE_ENV === 'development', // Enable devtools in dev mode
      }
    });

    hostWindow.addBrowserView(view);
    this.views.set(viewId, { view, hostWindowId: hostWindow.id, id: viewId });

    console.log(`BrowserViewManagerService: Created BrowserView with ID ${viewId} for host window ${hostWindow.id}`);

    view.webContents.loadURL(initialUrl).catch(err => {
        console.error(`BrowserViewManagerService: Failed to load initial URL for view ${viewId}: ${initialUrl}`, err);
        // view.webContents.loadURL('about:blank'); // Fallback
    });

    view.webContents.on('did-navigate', (_, url) => {
        console.log(`BrowserViewManagerService: View ${viewId} navigated to ${url}`);
        this.sendNavigationState(viewId, hostWindow, false); //isLoading is false
    });

    view.webContents.on('did-frame-navigate', (_, url) => { // Also handle frame navigations
        console.log(`BrowserViewManagerService: View ${viewId} frame navigated to ${url}`);
        // isLoading state might be true if main frame finished but subframes are loading
        const isLoading = view.webContents.isLoading() || view.webContents.isLoadingMainFrame();
        this.sendNavigationState(viewId, hostWindow, isLoading);
    });

    // Add these new listeners
    view.webContents.on('did-start-loading', () => {
      console.log(`BrowserViewManagerService: View ${viewId} started loading.`);
      this.sendNavigationState(viewId, hostWindow, true); //isLoading is true
    });

    view.webContents.on('did-stop-loading', () => {
      console.log(`BrowserViewManagerService: View ${viewId} stopped loading.`);
      const isLoading = view.webContents.isLoading() || view.webContents.isLoadingMainFrame();
      this.sendNavigationState(viewId, hostWindow, isLoading);
    });

    // Basic listeners - can be expanded
    view.webContents.on('page-title-updated', (_, title) => {
        // Use sendNavigationState to also update other states like canGoBack/Forward
        const isLoadingCurrent = view.webContents.isLoading() || view.webContents.isLoadingMainFrame();
        this.sendNavigationState(viewId, hostWindow, isLoadingCurrent);
        // The specific title update event can be removed if title is reliably in nav state and renderer uses that primarily.
        // For now, keeping it might be okay for components only interested in title.
        // However, to ensure consistency, relying on sendNavigationState is better.
        // if (!hostWindow.isDestroyed()){
        //     hostWindow.webContents.send(`browserView:titleUpdated:${viewId}`, title);
        // }
    });

    view.webContents.on('did-fail-load', (_, errorCode, errorDescription, validatedURL) => {
        console.error(`BrowserViewManagerService: View ${viewId} failed to load ${validatedURL}: ${errorDescription} (${errorCode})`);
        if (!hostWindow.isDestroyed()){
            hostWindow.webContents.send(`browserView:loadFailed:${viewId}`, {url: validatedURL, error: errorDescription, code: errorCode});
        }
        // Also send a general navigation state update
        this.sendNavigationState(viewId, hostWindow, false); // isLoading is false
    });


    return viewId;
  }

  public setBounds(viewId: string, bounds: Rectangle): boolean {
    const managedView = this.views.get(viewId);
    if (managedView) {
      managedView.view.setBounds(bounds);
      console.log(`BrowserViewManagerService: Set bounds for view ${viewId} to`, bounds);
      return true;
    }
    console.warn(`BrowserViewManagerService: View ${viewId} not found to set bounds.`);
    return false;
  }

  public showView(viewId: string, hostWindowId?: number): boolean {
    const managedView = this.views.get(viewId);
    const targetHostWindow = this.getHostWindow(managedView ? managedView.hostWindowId : hostWindowId);

    if (managedView && targetHostWindow) {
        const currentHostWindow = BrowserWindow.fromId(managedView.hostWindowId);
        // If the view is currently attached to a different window, remove it first.
        if (currentHostWindow && currentHostWindow.id !== targetHostWindow.id && currentHostWindow.getBrowserViews().includes(managedView.view)) {
            currentHostWindow.removeBrowserView(managedView.view);
        }

        // Add to the target window if not already there.
        if (!targetHostWindow.getBrowserViews().includes(managedView.view)) {
            targetHostWindow.addBrowserView(managedView.view);
        }
        managedView.hostWindowId = targetHostWindow.id; // Update hostWindowId
        console.log(`BrowserViewManagerService: View ${viewId} ensured to be on window ${targetHostWindow.id}.`);
        return true;
    }
    console.warn(`BrowserViewManagerService: View ${viewId} or host window not found for showing.`);
    return false;
  }

  public hideView(viewId: string): boolean {
    const managedView = this.views.get(viewId);
    if (managedView) {
        const hostWindow = BrowserWindow.fromId(managedView.hostWindowId);
        if (hostWindow && hostWindow.getBrowserViews().includes(managedView.view)) { // Check if it's actually on the window
            hostWindow.removeBrowserView(managedView.view);
            console.log(`BrowserViewManagerService: View ${viewId} removed from host window ${hostWindow.id} (hidden).`);
            return true;
        } else if (!hostWindow) {
             console.warn(`BrowserViewManagerService: Host window ${managedView.hostWindowId} for view ${viewId} not found during hide.`);
        }
    }
    console.warn(`BrowserViewManagerService: View ${viewId} not found or not attached for hiding.`);
    return false;
  }

  public destroyBrowserView(viewId: string): boolean {
    const managedView = this.views.get(viewId);
    if (managedView) {
      const hostWindow = BrowserWindow.fromId(managedView.hostWindowId);
      if (hostWindow && hostWindow.getBrowserViews().includes(managedView.view)) {
        hostWindow.removeBrowserView(managedView.view);
      }

      if (!managedView.view.webContents.isDestroyed()) {
        managedView.view.webContents.destroy();
      }
      this.views.delete(viewId);
      console.log(`BrowserViewManagerService: Destroyed BrowserView with ID ${viewId}`);
      return true;
    }
    console.warn(`BrowserViewManagerService: View ${viewId} not found for destruction.`);
    return false;
  }

  public navigateTo(viewId: string, url: string): boolean {
    const managedView = this.views.get(viewId);
    if (managedView) {
      managedView.view.webContents.loadURL(url).catch(err => {
          console.error(`BrowserViewManagerService: Failed to navigate view ${viewId} to URL: ${url}`, err);
      });
      // Navigation state will be sent by 'did-navigate' listener
      return true;
    }
    console.warn(`BrowserViewManagerService: View ${viewId} not found for navigation.`);
    return false;
  }

  public goBack(viewId: string): boolean {
    const managedView = this.views.get(viewId);
    if (managedView && managedView.view.webContents.canGoBack()) {
      managedView.view.webContents.goBack();
      // Navigation state will be sent by 'did-navigate' listener
      return true;
    }
    return false;
  }

  public goForward(viewId: string): boolean {
    const managedView = this.views.get(viewId);
    if (managedView && managedView.view.webContents.canGoForward()) {
      managedView.view.webContents.goForward();
      // Navigation state will be sent by 'did-navigate' listener
      return true;
    }
    return false;
  }

  public reload(viewId: string): boolean {
    const managedView = this.views.get(viewId);
    if (managedView) {
      managedView.view.webContents.reload();
      // Navigation state will be sent by 'did-navigate' listener
      return true;
    }
    return false;
  }

  public stop(viewId: string): boolean {
    const managedView = this.views.get(viewId);
    if (managedView) {
        managedView.view.webContents.stop();
        this.sendNavigationState(viewId, BrowserWindow.fromId(managedView.hostWindowId)); // Send state immediately on stop
        return true;
    }
    return false;
  }

  public getCurrentURL(viewId: string): string | null {
    const managedView = this.views.get(viewId);
    return managedView ? managedView.view.webContents.getURL() : null;
  }

  public getTitle(viewId: string): string | null {
    const managedView = this.views.get(viewId);
    return managedView ? managedView.view.webContents.getTitle() : null;
  }

  public isLoading(viewId: string): boolean {
    const managedView = this.views.get(viewId);
    return managedView ? managedView.view.webContents.isLoading() : false;
  }

  public isReady(viewId: string): boolean {
    const managedView = this.views.get(viewId);
    return managedView && !managedView.view.webContents.isLoading() && !managedView.view.webContents.isWaitingForResponse();
  }

  public canGoBack(viewId: string): boolean {
    const managedView = this.views.get(viewId);
    return managedView ? managedView.view.webContents.canGoBack() : false;
  }

  public canGoForward(viewId: string): boolean {
    const managedView = this.views.get(viewId);
    return managedView ? managedView.view.webContents.canGoForward() : false;
  }

  public openDevTools(viewId: string): boolean {
    const managedView = this.views.get(viewId);
    if (managedView && process.env.NODE_ENV === 'development') {
        managedView.view.webContents.openDevTools({ mode: 'detach' });
        return true;
    }
    return false;
  }

  // Method to send navigation state updates to renderer
  public sendNavigationState(viewId: string, window: BrowserWindow | null, isLoading: boolean) {
    const managedView = this.views.get(viewId);
    if (managedView && window && !window.isDestroyed()) {
        // Ensure webContents is still valid before accessing
        if (managedView.view.webContents && !managedView.view.webContents.isDestroyed()) {
          window.webContents.send(`browserView:navigationStateChanged:${viewId}`, {
              url: managedView.view.webContents.getURL(),
              canGoBack: managedView.view.webContents.canGoBack(),
              canGoForward: managedView.view.webContents.canGoForward(),
              isLoading: isLoading, // Add isLoading state
              title: managedView.view.webContents.getTitle() // Also send title
          });
        } else {
          console.warn(`BrowserViewManagerService: webContents for view ${viewId} is destroyed. Cannot send navigation state.`);
        }
    }
  }
}
