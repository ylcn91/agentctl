import type { AccountConfig } from "../types";
import type { NormalizedChunk } from "./stream-normalizer";
import { streamViaAgentSDK } from "./agent-sdk-client";
import { sendViaCli as sendViaCliFn, buildPrompt as buildPromptFn } from "./chat-session-cli";
import { getAuth, type AuthCredentials } from "./auth-store.js";
import { streamAnthropicResponse, type AnthropicMessage } from "./anthropic-client.js";

export type PartStatus = "pending" | "running" | "completed" | "error";

export interface TextPart {
  type: "text";
  text: string;
}

export interface ThinkingPart {
  type: "thinking";
  text: string;
  collapsed?: boolean;
}

export interface ToolPart {
  type: "tool";
  name: string;
  callId?: string;
  status: PartStatus;
  input?: string;
  output?: string;
  error?: string;
  durationMs?: number;
}

export interface ErrorPart {
  type: "error";
  text: string;
}

export type MessagePart = TextPart | ThinkingPart | ToolPart | ErrorPart;

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  streaming?: boolean;
  tokenCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
  durationMs?: number;
  parts?: MessagePart[];
  sdkSessionId?: string;
  model?: string;
}

export class ChatSession {
  private messages: ChatMessage[] = [];
  private account: AccountConfig;
  private activeProc: ReturnType<typeof Bun.spawn> | null = null;
  private abortController: AbortController | null = null;
  private sdkSessionId?: string;
  private model?: string;

  constructor(account: AccountConfig) {
    this.account = account;
  }

  setModel(model: string | undefined): void {
    this.model = model;
  }

  getModel(): string | undefined {
    return this.model;
  }

  getSessionId(): string | undefined {
    return this.sdkSessionId;
  }

  async send(
    message: string,
    onChunk: (chunk: NormalizedChunk) => void,
  ): Promise<ChatMessage> {
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      timestamp: new Date().toISOString(),
    };
    this.messages.push(userMsg);

    if (this.account.provider === "claude-code") {
      try {
        return await this.sendViaSDK(onChunk);
      } catch (sdkErr: any) {
        const creds = await getAuth(this.account.name);
        if (creds) {
          console.error(`[chat] SDK failed (${sdkErr.message?.slice(0, 80)}), falling back to direct API`);
          return this.sendViaAnthropicAPI(onChunk, creds);
        }
        throw sdkErr;
      }
    }
    return this.sendViaCli(onChunk);
  }

  private async sendViaSDK(
    onChunk: (chunk: NormalizedChunk) => void,
  ): Promise<ChatMessage> {
    this.abortController = new AbortController();
    const latestUserMsg = this.messages[this.messages.length - 1];

    const parts: MessagePart[] = [];

    const pending: { tool: { name: string; input?: string; startTime: number } | null } = { tool: null };

    const result = await streamViaAgentSDK({
      prompt: latestUserMsg.content,
      sessionId: this.sdkSessionId,
      model: this.model,
      onChunk: (chunk) => {
        if (chunk.chunkType === "thinking") {
          const last = parts[parts.length - 1];
          if (last?.type === "thinking") {
            last.text += chunk.content;
          } else {
            parts.push({ type: "thinking", text: chunk.content });
          }
        } else if (chunk.chunkType === "tool_use") {
          pending.tool = { name: chunk.toolName ?? chunk.content, input: chunk.toolInput, startTime: Date.now() };
          parts.push({
            type: "tool",
            name: chunk.toolName ?? chunk.content,
            status: "running",
            input: chunk.toolInput,
          });
        } else if (chunk.chunkType === "tool_result") {
          if (pending.tool) {
            for (let i = parts.length - 1; i >= 0; i--) {
              const p = parts[i];
              if (p.type === "tool" && p.name === pending.tool.name && p.status === "running") {
                p.status = "completed";
                p.output = chunk.content;
                p.durationMs = Date.now() - pending.tool.startTime;
                break;
              }
            }
            pending.tool = null;
          }
        } else if (chunk.chunkType === "text") {
          const last = parts[parts.length - 1];
          if (last?.type === "text") {
            last.text += chunk.content;
          } else {
            parts.push({ type: "text", text: chunk.content });
          }
        } else if (chunk.chunkType === "error") {
          parts.push({ type: "error", text: chunk.content });
        }
        onChunk(chunk);
      },
      signal: this.abortController.signal,
    });

    this.abortController = null;

    if (result.sessionId) this.sdkSessionId = result.sessionId;

    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: result.content,
      timestamp: new Date().toISOString(),
      tokenCount: result.tokenCount,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cost: result.cost,
      durationMs: result.durationMs,
      parts: parts.length > 0 ? parts : undefined,
      sdkSessionId: result.sessionId,
      model: result.model ?? this.model,
    };
    this.messages.push(assistantMsg);

    return assistantMsg;
  }

  private async sendViaAnthropicAPI(
    onChunk: (chunk: NormalizedChunk) => void,
    creds: AuthCredentials,
  ): Promise<ChatMessage> {
    this.abortController = new AbortController();

    const parts: MessagePart[] = [];
    const pending: { tool: { name: string; input?: string; startTime: number } | null } = { tool: null };

    const apiMessages: AnthropicMessage[] = this.messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    const result = await streamAnthropicResponse({
      accountName: this.account.name,
      creds,
      messages: apiMessages,
      model: this.model,
      onChunk: (chunk) => {
        if (chunk.chunkType === "thinking") {
          const last = parts[parts.length - 1];
          if (last?.type === "thinking") { last.text += chunk.content; }
          else { parts.push({ type: "thinking", text: chunk.content }); }
        } else if (chunk.chunkType === "tool_use") {
          pending.tool = { name: chunk.toolName ?? chunk.content, input: chunk.toolInput, startTime: Date.now() };
          parts.push({ type: "tool", name: chunk.toolName ?? chunk.content, status: "running", input: chunk.toolInput });
        } else if (chunk.chunkType === "tool_result") {
          if (pending.tool) {
            for (let i = parts.length - 1; i >= 0; i--) {
              const p = parts[i];
              if (p.type === "tool" && p.name === pending.tool.name && p.status === "running") {
                p.status = "completed"; p.output = chunk.content; p.durationMs = Date.now() - pending.tool.startTime;
                break;
              }
            }
            pending.tool = null;
          }
        } else if (chunk.chunkType === "text") {
          const last = parts[parts.length - 1];
          if (last?.type === "text") { last.text += chunk.content; }
          else { parts.push({ type: "text", text: chunk.content }); }
        } else if (chunk.chunkType === "error") {
          parts.push({ type: "error", text: chunk.content });
        }
        onChunk(chunk);
      },
      signal: this.abortController.signal,
    });

    this.abortController = null;

    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: result.content,
      timestamp: new Date().toISOString(),
      tokenCount: result.tokenCount,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs: result.durationMs,
      parts: parts.length > 0 ? parts : undefined,
      model: this.model,
    };
    this.messages.push(assistantMsg);
    return assistantMsg;
  }

  private async sendViaCli(
    onChunk: (chunk: NormalizedChunk) => void,
  ): Promise<ChatMessage> {
    const assistantMsg = await sendViaCliFn(this.account, this.messages, onChunk, {
      onProcess: (proc) => { this.activeProc = proc; },
      model: this.model,
    });
    assistantMsg.model = this.model;
    this.activeProc = null;
    this.messages.push(assistantMsg);
    return assistantMsg;
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.activeProc) {
      this.activeProc.kill();
      this.activeProc = null;
    }
  }

  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  restoreMessages(msgs: ChatMessage[]): void {
    this.messages = [...msgs];
  }

  restoreSdkSession(sessionId: string): void {
    this.sdkSessionId = sessionId;
  }

  clear(): void {
    this.abort();
    this.messages = [];
    this.sdkSessionId = undefined;
  }

  getAccount(): AccountConfig {
    return this.account;
  }

  buildPrompt(): string {
    return buildPromptFn(this.messages);
  }
}
