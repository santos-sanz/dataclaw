import { OpenRouterClient } from "@dataclaw/ai";

export interface DatasetLlmCandidate {
  ref: string;
  title: string;
  summary?: string;
  description?: string;
  tags?: string[];
  licenses?: string[];
  formats?: string[];
  quality?: number | null;
  voteCount?: number | null;
  downloadCount?: number | null;
  usabilityRating?: number | null;
  totalBytes?: number | null;
  fileCount?: number | null;
  lastUpdated?: string;
}

export interface DatasetLlmInsight {
  llmSummary?: string;
  llmUseCases?: string[];
  llmCaveats?: string[];
  llmRationale?: string;
}

export interface DatasetLlmEnrichmentResult {
  rerankedRefs: string[];
  insightsByRef: Record<string, DatasetLlmInsight>;
}

interface DatasetLlmModelResponse {
  rerankedRefs?: unknown;
  datasets?: unknown;
}

const LLM_TOP_K = 12;
const LLM_TIMEOUT_MS = 12_000;

export class DatasetLlmEnrichmentService {
  constructor(
    private readonly client: OpenRouterClient = new OpenRouterClient(),
    private readonly topK: number = LLM_TOP_K,
    private readonly timeoutMs: number = LLM_TIMEOUT_MS,
  ) {}

  async enrich(query: string, candidates: DatasetLlmCandidate[]): Promise<DatasetLlmEnrichmentResult | null> {
    if (!this.client.isConfigured()) return null;
    if (!candidates.length) return null;

    const top = candidates.slice(0, Math.max(1, this.topK));
    const knownRefs = new Set(top.map((item) => item.ref));

    const payload = {
      query: query.trim(),
      constraints: {
        maxSummaryChars: 160,
        maxUseCases: 4,
        maxCaveats: 3,
      },
      candidates: top,
    };

    try {
      const response = await withTimeout(
        this.client.chatJson<DatasetLlmModelResponse>([
          { role: "system", content: LLM_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(payload, null, 2) },
        ]),
        this.timeoutMs,
      );

      const rerankedRefs = sanitizeRerankedRefs(response.rerankedRefs, top);
      const insightsByRef = sanitizeInsights(response.datasets, knownRefs);
      return { rerankedRefs, insightsByRef };
    } catch {
      return null;
    }
  }
}

const LLM_SYSTEM_PROMPT = `
You improve Kaggle dataset selection quality.
Return only valid JSON with this exact shape:
{
  "rerankedRefs": ["owner/slug", "..."],
  "datasets": [
    {
      "ref": "owner/slug",
      "summary": "<=160 chars",
      "useCases": ["...", "..."],
      "caveats": ["...", "..."],
      "rationale": "brief fit rationale"
    }
  ]
}
Rules:
- rerankedRefs must contain only refs from candidates.
- Keep useCases max 4 items, caveats max 3 items.
- Keep summary concise and factual.
- Do not include markdown or extra keys.
`;

function sanitizeRerankedRefs(raw: unknown, fallbackTop: DatasetLlmCandidate[]): string[] {
  const fallback = fallbackTop.map((item) => item.ref);
  if (!Array.isArray(raw)) return fallback;

  const allowed = new Set(fallback);
  const ranked = raw
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => allowed.has(value));

  const deduped = dedupe(ranked);
  if (!deduped.length) return fallback;

  for (const ref of fallback) {
    if (!deduped.includes(ref)) {
      deduped.push(ref);
    }
  }
  return deduped;
}

function sanitizeInsights(raw: unknown, knownRefs: Set<string>): Record<string, DatasetLlmInsight> {
  if (!Array.isArray(raw)) return {};

  const out: Record<string, DatasetLlmInsight> = {};
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const value = item as Record<string, unknown>;
    const ref = readString(value.ref);
    if (!ref || !knownRefs.has(ref)) continue;

    const summary = trimTo(readString(value.summary), 160);
    const useCases = readStringArray(value.useCases, 4);
    const caveats = readStringArray(value.caveats, 3);
    const rationale = trimTo(readString(value.rationale), 240);

    out[ref] = {
      llmSummary: summary,
      llmUseCases: useCases.length ? useCases : undefined,
      llmCaveats: caveats.length ? caveats : undefined,
      llmRationale: rationale,
    };
  }

  return out;
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function readStringArray(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const out = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return dedupe(out).slice(0, maxItems);
}

function trimTo(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  if (value.length <= maxLength) return value;
  if (maxLength <= 3) return value.slice(0, maxLength);
  return `${value.slice(0, maxLength - 3)}...`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`LLM enrichment timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
