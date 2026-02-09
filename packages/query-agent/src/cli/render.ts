import { renderAskResult as renderSharedAskResult, type AskResult, type AskRenderOptions } from "@dataclaw/shared";

export function renderAskResult(result: AskResult, options: AskRenderOptions = {}): string {
  return renderSharedAskResult(result, {
    maxWidth: process.stdout.columns ?? 100,
    ...options,
  });
}
