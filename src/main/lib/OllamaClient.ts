// src/main/lib/OllamaClient.ts
import * as http from 'http';
import * as https from 'https'; // Import https as well for flexibility

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[]; // For multimodal models
}

interface OllamaChatRequestBody {
  model: string;
  messages: OllamaMessage[];
  stream?: boolean;
  template?: string;
  options?: Record<string, any>; // For temperature, top_p etc.
}

interface OllamaChatResponseChunk { // For streaming
  model: string;
  created_at: string;
  message?: OllamaMessage; // Message will be populated gradually
  done: boolean; // True for the last chunk
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface OllamaChatResponseNonStreamed {
  model: string;
  created_at: string;
  message: OllamaMessage; // Complete message object
  done: true; // Always true for non-streamed
  total_duration: number;
  load_duration: number;
  prompt_eval_count: number;
  prompt_eval_duration: number;
  eval_count: number;
  eval_duration: number;
}


export class OllamaClient {
  private baseURL: URL;
  private httpAgent: http.Agent; // For keep-alive

  constructor(baseURL: string = 'http://localhost:11434') {
    try {
      this.baseURL = new URL(baseURL);
    } catch (error) {
      console.error('OllamaClient: Invalid baseURL provided:', baseURL, error);
      throw new Error('Invalid Ollama baseURL');
    }
    this.httpAgent = new http.Agent({ keepAlive: true });
    console.log(`OllamaClient initialized with baseURL: ${this.baseURL.href}`);
  }

  public async generateChatCompletion(
    model: string,
    messages: OllamaMessage[],
    stream: boolean = false, // Keep stream parameter for future, but implement non-streaming first
    options?: Record<string, any> // For temperature, top_p, etc.
  ): Promise<string | null> {

    if (stream) {
      console.warn('OllamaClient: Streaming not fully implemented yet. Will attempt non-streaming.');
      // For now, we'll just proceed as if stream = false, or return a placeholder.
      // In a real streaming implementation, this method would return an EventEmitter or an AsyncIterable.
    }

    const requestBody: OllamaChatRequestBody = {
      model,
      messages,
      stream: false, // Force non-streaming for this initial implementation
      options
    };

    const payload = JSON.stringify(requestBody);
    const requester = this.baseURL.protocol === 'https:' ? https : http;

    const params: http.RequestOptions = {
      hostname: this.baseURL.hostname,
      port: this.baseURL.port,
      path: '/api/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      agent: this.httpAgent, // Use keep-alive agent
    };

    console.log(`OllamaClient: Sending request to ${this.baseURL.href}api/chat with model ${model}. Messages count: ${messages.length}`);

    return new Promise<string | null>((resolve, reject) => {
      const req = requester.request(params, (res) => {
        let data = '';
        res.setEncoding('utf8');

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsedResponse: OllamaChatResponseNonStreamed = JSON.parse(data);
              if (parsedResponse.message && parsedResponse.message.content) {
                console.log(`OllamaClient: Received successful non-streamed response for model ${model}.`);
                resolve(parsedResponse.message.content);
              } else {
                console.error('OllamaClient: Response missing message content.', parsedResponse);
                reject(new Error('Ollama response did not contain message content.'));
              }
            } catch (error) {
              console.error('OllamaClient: Failed to parse Ollama response JSON:', data, error);
              reject(new Error('Failed to parse Ollama response.'));
            }
          } else {
            console.error(`OllamaClient: Request failed with status ${res.statusCode}. Response data: ${data}`);
            reject(new Error(`Ollama API request failed with status code: ${res.statusCode}. Response: ${data.substring(0,200)}`));
          }
        });
      });

      req.on('error', (error) => {
        console.error('OllamaClient: Request error:', error);
        reject(new Error(`Ollama API request error: ${error.message}`));
      });

      req.write(payload);
      req.end();
    });
  }

  // Placeholder for a simple health check or model listing
  public async listModels(): Promise<any> {
    const requester = this.baseURL.protocol === 'https:' ? https : http;
    const params: http.RequestOptions = {
      hostname: this.baseURL.hostname,
      port: this.baseURL.port,
      path: '/api/tags', // Common endpoint to list local models
      method: 'GET',
      agent: this.httpAgent,
    };

    console.log(`OllamaClient: Listing models from ${this.baseURL.href}api/tags`);

    return new Promise<any>((resolve, reject) => {
      const req = requester.request(params, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error('Failed to parse models list response.'));
            }
          } else {
            reject(new Error(`Failed to list models. Status: ${res.statusCode}, Data: ${data.substring(0,100)}`));
          }
        });
      });
      req.on('error', (e) => reject(e));
      req.end();
    });
  }
}
