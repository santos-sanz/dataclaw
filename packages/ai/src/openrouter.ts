import { DataClawError } from "@dataclaw/shared";

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenRouterClientOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  appName?: string;
  siteUrl?: string;
}

export class OpenRouterClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly appName?: string;
  private readonly siteUrl?: string;

  constructor(options: OpenRouterClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
    this.baseUrl = options.baseUrl ?? process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
    this.model = options.model ?? process.env.OPENROUTER_MODEL ?? "openrouter/auto";
    this.appName = options.appName ?? process.env.OPENROUTER_APP_NAME;
    this.siteUrl = options.siteUrl ?? process.env.OPENROUTER_SITE_URL;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async chat(messages: OpenRouterMessage[], temperature: number = 0): Promise<string> {
    if (!this.apiKey) {
      throw new DataClawError(
        "OPENROUTER_API_KEY is missing. Set it in your environment or .env file.",
        "OPENROUTER_NOT_CONFIGURED",
      );
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(this.appName ? { "HTTP-Referer": this.siteUrl ?? "https://localhost" } : {}),
        ...(this.appName ? { "X-Title": this.appName } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        temperature,
        messages,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new DataClawError(`OpenRouter request failed (${response.status}): ${text}`, "OPENROUTER_REQUEST_FAILED");
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new DataClawError("OpenRouter response did not include message content.", "OPENROUTER_EMPTY_RESPONSE");
    }

    return content;
  }

  async chatJson<T>(messages: OpenRouterMessage[]): Promise<T> {
    const responseText = await this.chat(messages, 0);

    const normalized = responseText.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    try {
      return JSON.parse(normalized) as T;
    } catch (error) {
      throw new DataClawError(
        `OpenRouter returned invalid JSON. Raw content: ${responseText}`,
        "OPENROUTER_INVALID_JSON",
      );
    }
  }
}
