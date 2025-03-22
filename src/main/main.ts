import { MiniWindowService } from './services/MiniWindowService'
import { InjectService } from './services/InjectService'
import { MiniWindowIPCService } from './services/MiniWindowIPCService'
import { McpService } from './services/MCPService'
import { CopilotService } from './services/CopilotService'
import { BinaryService } from './services/BinaryService'
import { OAuthService } from './services/OAuthService'
import { GoogleDriveService } from './services/GoogleDriveService'
import { OneDriveService } from './services/OneDriveService'

// initialize services
export function initServices() {
  // ... existing code ...
  
  // 初始化OAuth和云存储服务
  const oauthService = new OAuthService()
  const googleDriveService = new GoogleDriveService()
  const oneDriveService = new OneDriveService()
  
  oauthService.registerHandlers()
  googleDriveService.registerHandlers()
  oneDriveService.registerHandlers()
  
  // ... existing code ...
} 