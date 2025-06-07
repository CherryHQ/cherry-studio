// src/main/services/AgentMultiplexerService.ts
import { OllamaClient } from '../lib/OllamaClient';
import { GoogleSearchService } from './GoogleSearchService';
import { BrowserViewManagerService } from './BrowserViewManagerService';
import { GitHubService } from './GitHubService';
import { HuggingFaceService, HFModelInfo } from './HuggingFaceService'; // Added
import { BrowserWindow } from 'electron';
// Add these interfaces
interface AgentActionRequest {
  action: string; // e.g., 'google_search', 'browse_url'
  parameters: Record<string, any>;
}

interface AgentActionResult {
  action: string;
  status: 'success' | 'error';
  result: any; // Could be search results, page content, etc.
  error?: string;
}

// Ensure AgentContextMessage supports an optional action_result for system messages
 interface AgentContextMessage {
     role: 'user' | 'assistant' | 'system' | 'tool'; // Add 'tool' role for action results
     content: string;
     name?: string; // For tool role, name of the tool/action
     action_request?: AgentActionRequest; // If assistant requests an action
     action_result?: AgentActionResult;  // If system provides result of an action
     images?: string[];
 }

interface AgentState {
  id: string;
  name: string;
  persona: string;
  model: string; // Specific model for this agent, e.g., "llama3:latest"
  contextHistory: AgentContextMessage[];
  objective: string | null;
}

export class AgentMultiplexerService {
  private activeAgents: Map<string, AgentState> = new Map();
  private agentProcessingLoopTimeoutId: NodeJS.Timeout | null = null;
  private isProcessingAgent: Set<string> = new Set(); // Tracks IDs of agents currently in processAgentTurn
  private ollamaClient: OllamaClient;
  private googleSearchService: GoogleSearchService;
  private browserViewManagerService: BrowserViewManagerService;
  private githubService: GitHubService;
  private huggingFaceService: HuggingFaceService; // Added

  constructor(
    ollamaBaseURL: string | undefined,
    googleSearchService: GoogleSearchService,
    browserViewManagerService: BrowserViewManagerService,
    githubService: GitHubService,
    huggingFaceService: HuggingFaceService // Add new
  ) {
    console.log('AgentMultiplexerService: Initialized');
    this.ollamaClient = new OllamaClient(ollamaBaseURL);
    this.googleSearchService = googleSearchService;
    this.browserViewManagerService = browserViewManagerService;
    this.githubService = githubService;
    this.huggingFaceService = huggingFaceService; // Assign
    console.log('AgentMultiplexerService: All required services injected.');
  }

  public addAgent(agentId: string, name: string, persona: string, model: string, objective: string | null = null): boolean {
    if (this.activeAgents.has(agentId)) {
      console.warn(`AgentMultiplexerService: Agent with ID ${agentId} already exists.`);
      return false;
    }
    const newAgent: AgentState = {
      id: agentId,
      name,
      persona,
      model, // Store the model for the agent
      contextHistory: [{ role: 'system', content: persona }],
      objective,
    };
    this.activeAgents.set(agentId, newAgent);
    console.log(`AgentMultiplexerService: Agent ${name} (ID: ${agentId}, Model: ${model}) added with objective: ${objective || 'None'}.`);

    // Optionally start the loop if it's not running and this is the first agent
    if (!this.agentProcessingLoopTimeoutId && this.activeAgents.size === 1) {
        // this.startProcessingLoop(); // Decide if adding an agent should auto-start the loop
    }
    return true;
  }

  public removeAgent(agentId: string): boolean {
    if (this.activeAgents.has(agentId)) {
      this.activeAgents.delete(agentId);
      console.log(`AgentMultiplexerService: Agent ID ${agentId} removed.`);
      // Optionally stop the loop if no agents are left
      if (this.activeAgents.size === 0 && this.agentProcessingLoopTimeoutId) {
        this.stopProcessingLoop();
      }
      return true;
    }
    console.warn(`AgentMultiplexerService: Agent with ID ${agentId} not found for removal.`);
    return false;
  }

  public async sendMessageToAgent(agentId: string, userInput: string, images?: string[]): Promise<string | null> {
    const agent = this.activeAgents.get(agentId);
    if (!agent) {
      console.error(`AgentMultiplexerService: Agent ${agentId} not found when trying to send message.`);
      return "Error: Agent not found.";
    }

    const userMessage: AgentContextMessage = { role: 'user', content: userInput };
    if (images && images.length > 0) {
      userMessage.images = images;
    }
    agent.contextHistory.push(userMessage);

    console.log(`AgentMultiplexerService: Message from user for agent ${agent.name} (ID: ${agentId}): "${userInput.substring(0, 100)}..." (Images: ${images ? images.length : 0})`);
    this.activeAgents.set(agent.id, agent);

    if (this.isProcessingAgent.has(agentId)) {
        console.log(`AgentMultiplexerService: Agent ${agentId} is currently busy. Message has been added to history and will be processed in turn.`);
        return "Agent is busy, message queued. It will be processed shortly.";
    }

    // Attempt to process immediately since there's new input
    try {
      const response = await this.processAgentTurn(agent);
      return response;
    } catch (error) {
      console.error(`AgentMultiplexerService: Error processing turn for agent ${agentId} after user message:`, error);
      agent.contextHistory.push({ role: 'assistant', content: "Sorry, I encountered an error processing your request." });
      this.activeAgents.set(agent.id, agent);
      return "Error: Could not get a response due to an internal error.";
    }
  }

  private async processAgentTurn(agent: AgentState): Promise<string | null> {
    if (this.isProcessingAgent.has(agent.id)) {
        // This check is a safeguard, normally sendMessageToAgent should prevent this for direct calls.
        // The loop also checks this before calling.
        console.log(`AgentMultiplexerService: processAgentTurn called for ${agent.id}, but it's already processing. Skipping.`);
        return null;
    }

    this.isProcessingAgent.add(agent.id);
    console.log(`AgentMultiplexerService: Processing turn for agent ${agent.name} (ID: ${agent.id})`);

    try {
       if (agent.contextHistory.length === 0 || agent.contextHistory[0].role !== 'system') {
           agent.contextHistory.unshift({ role: 'system', content: agent.persona });
       }

       // Modify system prompt slightly to hint at tool use for some agents
       let currentSystemPrompt = agent.persona;
       const availableTools = ["google_search", "browse_url", "get_github_file_content", "list_huggingface_models"]; // New

       if (agent.name.toLowerCase().includes("research") ||
           agent.name.toLowerCase().includes("search") ||
           agent.name.toLowerCase().includes("developer") ||
           agent.name.toLowerCase().includes("browse")) {

           let toolDescriptions = "You can use tools. To use a tool, respond ONLY with a single valid JSON object with \"action\" and \"parameters\". Do not add any other text before or after the JSON. For example:\n";
           toolDescriptions += `{"action": "google_search", "parameters": {"query": "your search query"}}\n`;
           toolDescriptions += `{"action": "browse_url", "parameters": {"url": "full_url_to_browse"}}\n`;
           toolDescriptions += `{"action": "get_github_file_content", "parameters": {"owner": "repository_owner", "repo": "repository_name", "path": "path/to/file_in_repo.ext"}}\n`;
           toolDescriptions += `{"action": "list_huggingface_models", "parameters": {"search_query": "text to search models", "limit": 5}}\n`; // New example
           toolDescriptions += `Available tools: ${availableTools.join(', ')}. Only use a tool if necessary to answer the user. If you use a tool, I will provide its result, and then you should formulate the final response to the user based on that tool result.`;

           currentSystemPrompt = agent.persona + "\n\n" + toolDescriptions;

           if(agent.contextHistory[0].role === 'system') {
               agent.contextHistory[0].content = currentSystemPrompt;
           }
       }

       const messagesForOllama: AgentContextMessage[] = agent.contextHistory.map(m => ({
           role: m.role,
           content: m.content,
           images: m.images,
           ...(m.role === 'tool' && m.name && { name: m.name }),
       }));

       const modelForOllama = agent.model;
       console.log(`AgentMultiplexerService: Sending payload to Ollama for agent ${agent.id}. Model: ${modelForOllama}. Context length: ${messagesForOllama.length}`);

       const ollamaResponseContent = await this.ollamaClient.generateChatCompletion(
           modelForOllama,
           messagesForOllama,
           false
       );

       if (ollamaResponseContent) {
           console.log(`AgentMultiplexerService: Raw response from Ollama for agent ${agent.id}: "${ollamaResponseContent.substring(0, 200)}..."`);

           const actionRequest = this.tryParseActionRequest(ollamaResponseContent);

           if (actionRequest) {
               console.log(`AgentMultiplexerService: Agent ${agent.id} requested action: ${actionRequest.action}`);

               // Emit event that action is starting
               const mainWindow = BrowserWindow.getAllWindows().find(win => !win.isDestroyed()); // Find any valid window
               if (mainWindow) {
                   mainWindow.webContents.send('agent-action-statusUpdate', {
                       agentId: agent.id,
                       actionName: actionRequest.action,
                       parameters: actionRequest.parameters,
                       status: 'started',
                       timestamp: new Date().toISOString()
                   });
               }

               agent.contextHistory.push({
                   role: 'assistant',
                   content: ollamaResponseContent,
                   action_request: actionRequest
               });

               let actionResultData: any;
               let actionStatus: 'success' | 'error' = 'error';
               let actionError: string | undefined;

               if (actionRequest.action === 'google_search') {
                   if (!this.googleSearchService) { // Should ideally use the dummy if not properly injected
                       actionError = "GoogleSearchService is not configured.";
                   } else if (actionRequest.parameters && typeof actionRequest.parameters.query === 'string') {
                       try {
                           const searchResults: any = await this.googleSearchService.search(actionRequest.parameters.query, 5);
                           if (searchResults.error) {
                               actionError = searchResults.error.message || "Unknown error from Google Search.";
                               actionResultData = searchResults.error;
                           } else {
                               actionResultData = searchResults.items || [];
                               actionStatus = 'success';
                               console.log(`AgentMultiplexerService: Google search successful for query "${actionRequest.parameters.query}", ${actionResultData.length} items found.`);
                           }
                       } catch (e: any) {
                           actionError = e.message || "Exception during Google search.";
                           actionResultData = { error: actionError };
                       }
                   } else {
                       actionError = "Missing 'query' parameter for google_search action.";
                   }
               } else if (actionRequest.action === 'browse_url') {
                   const BROWSER_PANE_VIEW_ID = 'mainSkyscopeBrowser'; // Consistent ID
                   if (!this.browserViewManagerService) {
                       actionError = "BrowserViewManagerService is not configured.";
                   } else if (actionRequest.parameters && typeof actionRequest.parameters.url === 'string') {
                       const urlToBrowse = actionRequest.parameters.url;
                       try {
                           const mainWindow = BrowserWindow.getAllWindows()[0];
                           if (mainWindow) {
                                this.browserViewManagerService.showView(BROWSER_PANE_VIEW_ID, mainWindow.id);
                           }

                           const success = this.browserViewManagerService.navigateTo(BROWSER_PANE_VIEW_ID, urlToBrowse);
                           if (success) {
                               actionResultData = { status: `Successfully navigated to ${urlToBrowse}. The browser view should now display this page. What should I look for or do next on this page?` };
                               actionStatus = 'success';
                               console.log(`AgentMultiplexerService: Browse URL successful for URL: ${urlToBrowse}`);
                           } else {
                               actionError = `Failed to initiate navigation to ${urlToBrowse}.`;
                               actionResultData = { error: actionError };
                           }
                       } catch (e: any) {
                           actionError = e.message || `Exception during browsing to ${urlToBrowse}.`;
                           actionResultData = { error: actionError };
                       }
                   } else {
                       actionError = "Missing 'url' parameter for browse_url action.";
                   }
               } else if (actionRequest.action === 'get_github_file_content') {
                   if (!this.githubService) {
                       actionError = "GitHubService is not configured.";
                   } else if (actionRequest.parameters &&
                              typeof actionRequest.parameters.owner === 'string' &&
                              typeof actionRequest.parameters.repo === 'string' &&
                              typeof actionRequest.parameters.path === 'string') {
                       const { owner, repo, path } = actionRequest.parameters;
                       try {
                           const fileResult = await this.githubService.getFileContent(owner, repo, path);

                           if (fileResult !== null) {
                               actionResultData = {
                                   filePath: `${owner}/${repo}/${path}`,
                                   content: fileResult.substring(0, 1500) + (fileResult.length > 1500 ? "\n... (content truncated)" : "")
                               };
                               actionStatus = 'success';
                               console.log(`AgentMultiplexerService: GitHub getFileContent successful for: ${owner}/${repo}/${path}`);
                           } else {
                               actionError = `Failed to retrieve or file empty/not found: ${owner}/${repo}/${path}.`;
                               actionResultData = { error: actionError, note: "File might be binary, too large, or path is incorrect." };
                           }
                       } catch (e: any) {
                           actionError = e.message || `Exception during GitHub getFileContent for ${owner}/${repo}/${path}.`;
                           actionResultData = { error: actionError };
                       }
                   } else {
                       actionError = "Missing 'owner', 'repo', or 'path' parameter for get_github_file_content action.";
                   }
                } else if (actionRequest.action === 'list_huggingface_models') {
                    if (!this.huggingFaceService) {
                        actionError = "HuggingFaceService is not configured.";
                    } else if (actionRequest.parameters) {
                        const searchQuery = typeof actionRequest.parameters.search_query === 'string' ? actionRequest.parameters.search_query : undefined;
                        const limit = typeof actionRequest.parameters.limit === 'number' ? actionRequest.parameters.limit : 5; // Default limit
                        try {
                            const modelsResult = await this.huggingFaceService.listModels(searchQuery, undefined, undefined, limit, true);

                            const simplifiedModels = modelsResult.map((m: HFModelInfo) => ({
                                modelId: m.modelId,
                                pipeline_tag: m.pipeline_tag,
                                tags: m.tags?.slice(0,3)
                            }));

                            actionResultData = {
                                count: simplifiedModels.length,
                                models: simplifiedModels
                            };
                            actionStatus = 'success';
                            console.log(`AgentMultiplexerService: Hugging Face listModels successful for query: "${searchQuery}", ${simplifiedModels.length} items found.`);
                        } catch (e: any) {
                            actionError = e.message || `Exception during Hugging Face listModels for query: ${searchQuery}.`;
                            actionResultData = { error: actionError };
                        }
                    } else {
                        actionError = "Missing 'parameters' for list_huggingface_models action.";
                    }
               } else {
                   actionError = `Unknown action: ${actionRequest.action}`;
               }

               const toolMessageContent = actionStatus === 'success' ?
                   JSON.stringify(actionResultData, null, 2) :
                   `Error performing action ${actionRequest.action}: ${actionError}`;

               agent.contextHistory.push({
                   role: 'tool',
                   name: actionRequest.action,
                   content: toolMessageContent,
                   action_result: {
                       action: actionRequest.action,
                       status: actionStatus,
                       result: actionResultData,
                       error: actionError
                   }
               });

               console.log(`AgentMultiplexerService: Added tool result to context for agent ${agent.id}. Reprompting LLM.`);

               const finalOllamaResponse = await this.ollamaClient.generateChatCompletion(
                   modelForOllama,
                   agent.contextHistory.map(m => ({role: m.role, content: m.content, images: m.images, name: m.name }) as AgentContextMessage),
                   false
               );

               if (finalOllamaResponse) {
                   agent.contextHistory.push({ role: 'assistant', content: finalOllamaResponse });
                   this.activeAgents.set(agent.id, agent);
                   return finalOllamaResponse;
               } else {
                    const fallbackMsg = "After using a tool, I could not generate a final response.";
                    agent.contextHistory.push({ role: 'assistant', content: fallbackMsg });
                    this.activeAgents.set(agent.id, agent);
                    return fallbackMsg;
               }

           } else {
               // No action requested, treat as a normal chat response
               agent.contextHistory.push({ role: 'assistant', content: ollamaResponseContent });
               this.activeAgents.set(agent.id, agent);
               return ollamaResponseContent;
           }
       } else {
           console.warn(`AgentMultiplexerService: No content in Ollama response for agent ${agent.id}`);
           const errMsg = "I received an empty response from the AI model.";
           agent.contextHistory.push({ role: 'assistant', content: errMsg });
           this.activeAgents.set(agent.id, agent);
           return null;
       }
    } catch (error: any) {
       console.error(`AgentMultiplexerService: Error in processAgentTurn for agent ${agent.id}:`, error.message);
       const errorMessage = error.message || "An unknown error occurred processing the turn.";
       agent.contextHistory.push({ role: 'assistant', content: `Sorry, I encountered an error: ${errorMessage}` });
       this.activeAgents.set(agent.id, agent);
       return `Sorry, an error occurred: ${errorMessage}`;
    } finally {
      this.isProcessingAgent.delete(agent.id);
      console.log(`AgentMultiplexerService: Finished processing turn for agent ${agent.id}`);

       const MAX_CONTEXT_ITEMS = 20;
       if (agent.contextHistory.length > MAX_CONTEXT_ITEMS) {
         const personaMsg = agent.contextHistory.find(m => m.role === 'system');
         const otherMessages = agent.contextHistory.filter(m => m.role !== 'system');
         const trimmedMessages = otherMessages.slice(-(MAX_CONTEXT_ITEMS - (personaMsg ? 1 : 0)));
         agent.contextHistory = personaMsg ? [personaMsg, ...trimmedMessages] : trimmedMessages;
         this.activeAgents.set(agent.id, agent);
       }
    }
  }

  private tryParseActionRequest(responseText: string): AgentActionRequest | null {
    try {
      const jsonRegex = /(?:```json\s*)?(\{[\s\S]*?\})(?:\s*```)?/;
      const match = responseText.match(jsonRegex);
      if (match && match[1]) {
        const potentialJson = match[1];
        const parsed = JSON.parse(potentialJson);
        if (parsed && typeof parsed.action === 'string' && typeof parsed.parameters === 'object') {
          console.log('AgentMultiplexerService: Parsed action request:', parsed);
          return parsed as AgentActionRequest;
        }
      }
    } catch (e) {
      // console.log('AgentMultiplexerService: No valid JSON action found in response.', e);
    }
    return null;
  }

  // Main agent processing loop (turn-based)
  private async agentLoop(): Promise<void> {
    // console.log('AgentMultiplexerService Loop: Tick');
    if (this.activeAgents.size === 0) {
      this.agentProcessingLoopTimeoutId = setTimeout(() => this.agentLoop(), 5000); // Check again in 5s if no agents
      return;
    }

    const agentsToConsider = Array.from(this.activeAgents.values());

    for (const agent of agentsToConsider) {
      if (this.isProcessingAgent.has(agent.id)) {
        // console.log(`AgentMultiplexerService Loop: Agent ${agent.id} is already processing by a direct call, skipping in loop.`);
        continue;
      }

      // Simple condition: if the last message is from the user, the agent should respond.
      const lastMessage = agent.contextHistory[agent.contextHistory.length - 1];
      if (lastMessage && lastMessage.role === 'user') {
        console.log(`AgentMultiplexerService Loop: Agent ${agent.name} (ID: ${agent.id}) has a pending user message. Processing.`);
        await this.processAgentTurn(agent); // Process its turn
        await new Promise(resolve => setTimeout(resolve, 200)); // Small stagger between processing agents in the loop
      } else if (agent.objective /* && conditions for background work */) {
        // Placeholder for agents performing background tasks based on objectives
        // console.log(`AgentMultiplexerService Loop: Agent ${agent.name} (ID: ${agent.id}) has an objective. (Background processing not yet implemented)`);
      }
    }
    // Schedule the next iteration of the loop
    const loopInterval = 5000 + Math.random() * 2000; // Randomize interval slightly
    this.agentProcessingLoopTimeoutId = setTimeout(() => this.agentLoop(), loopInterval);
  }

  public startProcessingLoop(initialDelayMs: number = 3000): void {
    if (this.agentProcessingLoopTimeoutId) {
      console.warn('AgentMultiplexerService: Processing loop is already running or scheduled. Call stopProcessingLoop() first if you intend to restart.');
      return;
    }
    console.log(`AgentMultiplexerService: Starting processing loop with initial delay ${initialDelayMs}ms.`);
    this.agentProcessingLoopTimeoutId = setTimeout(() => this.agentLoop(), initialDelayMs);
  }

  public stopProcessingLoop(): void {
    if (this.agentProcessingLoopTimeoutId) {
      clearTimeout(this.agentProcessingLoopTimeoutId);
      this.agentProcessingLoopTimeoutId = null;
      console.log('AgentMultiplexerService: Processing loop stopped.');
    } else {
      console.log('AgentMultiplexerService: Processing loop was not running.');
    }
  }
}
