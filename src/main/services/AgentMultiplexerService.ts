// src/main/services/AgentMultiplexerService.ts
import { OllamaClient } from '../lib/OllamaClient';

// At the top of AgentMultiplexerService.ts
interface AgentContextMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: string[]; // Optional base64 encoded images for multimodal models
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

  constructor(ollamaBaseURL?: string) { // ollamaBaseURL is optional for default
    console.log('AgentMultiplexerService: Initialized');
    this.ollamaClient = new OllamaClient(ollamaBaseURL); // Pass optional base URL
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
        // Ensure persona is the first message
        agent.contextHistory.unshift({ role: 'system', content: agent.persona });
      }

      // Map context history to the format expected by OllamaClient, including images
      const messagesForOllama: Array<{role: 'system' | 'user' | 'assistant', content: string, images?: string[]}> = agent.contextHistory.map(m => ({
         role: m.role,
         content: m.content,
         images: m.images // Pass images if they exist on the message
      }));

      const modelForOllama = agent.model; // Use the agent-specific model

      const lastUserMsg = messagesForOllama.filter(m=>m.role==='user').pop()?.content || "initial prompt";
      console.log(`AgentMultiplexerService: Sending payload to Ollama for agent ${agent.id}. Model: ${modelForOllama}. Last user message: "${lastUserMsg.substring(0,50)}..." Context length: ${messagesForOllama.length}`);

      // Actual Ollama call using the client
      const ollamaResponseContent = await this.ollamaClient.generateChatCompletion(
        modelForOllama,
        messagesForOllama,
        false // Non-streaming for now
        // TODO: Add agent-specific options (temperature, etc.) from agent.settings if that's added to AgentState
      );

      if (ollamaResponseContent) {
        console.log(`AgentMultiplexerService: Received response from Ollama for agent ${agent.id}: "${ollamaResponseContent.substring(0,100)}..."`);
        agent.contextHistory.push({ role: 'assistant', content: ollamaResponseContent });

        // Simple context trimming strategy: Keep persona + last N-1 messages
        const MAX_CONTEXT_ITEMS = 20; // Example, make configurable
        if (agent.contextHistory.length > MAX_CONTEXT_ITEMS) {
          const personaMsg = agent.contextHistory.find(m => m.role === 'system'); // Should always be present due to the check above
          const otherMessages = agent.contextHistory.filter(m => m.role !== 'system');
          const trimmedMessages = otherMessages.slice(-(MAX_CONTEXT_ITEMS - (personaMsg ? 1 : 0)));
          agent.contextHistory = personaMsg ? [personaMsg, ...trimmedMessages] : trimmedMessages;
        }
        this.activeAgents.set(agent.id, agent); // Update agent state in the map
        return ollamaResponseContent;
      } else {
        console.warn(`AgentMultiplexerService: No content in Ollama response for agent ${agent.id}`);
        agent.contextHistory.push({ role: 'assistant', content: "I received an empty response from the AI model." });
        this.activeAgents.set(agent.id, agent);
        return null;
      }
    } catch (error: any) {
      console.error(`AgentMultiplexerService: Error during Ollama call for agent ${agent.id}:`, error.message);
      const errorMessage = error.message || "An unknown error occurred with the AI model.";
      agent.contextHistory.push({ role: 'assistant', content: `Sorry, I encountered an error: ${errorMessage}` });
      this.activeAgents.set(agent.id, agent);
      return `Sorry, an error occurred: ${errorMessage}`;
    } finally {
      this.isProcessingAgent.delete(agent.id); // Release the lock for this agent
      console.log(`AgentMultiplexerService: Finished processing turn for agent ${agent.id}`);
    }
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
