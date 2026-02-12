import assert from "node:assert/strict";
import test from "node:test";
import { DatasetLlmEnrichmentService } from "./dataset-llm-enrichment-service.js";

test("enrich returns null when LLM client is not configured", async () => {
  const service = new DatasetLlmEnrichmentService(
    {
      isConfigured: () => false,
      chatJson: async () => {
        throw new Error("should not be called");
      },
    } as never,
  );

  const result = await service.enrich("sales", [{ ref: "owner/ds", title: "Dataset" }]);
  assert.equal(result, null);
});

test("enrich sanitizes reranked refs and insights payload", async () => {
  const service = new DatasetLlmEnrichmentService(
    {
      isConfigured: () => true,
      chatJson: async () => ({
        rerankedRefs: ["owner/b", "owner/unknown", "owner/a"],
        datasets: [
          {
            ref: "owner/a",
            summary: "A concise summary",
            useCases: ["forecasting", "segmentation", "segmentation"],
            caveats: ["missing values", "sample bias", "sample bias", "high leakage risk"],
            rationale: "Good fit for the user query.",
          },
        ],
      }),
    } as never,
  );

  const result = await service.enrich("sales", [
    { ref: "owner/a", title: "A" },
    { ref: "owner/b", title: "B" },
  ]);

  assert.ok(result);
  assert.deepEqual(result.rerankedRefs, ["owner/b", "owner/a"]);
  assert.equal(result.insightsByRef["owner/a"]?.llmSummary, "A concise summary");
  assert.deepEqual(result.insightsByRef["owner/a"]?.llmUseCases, ["forecasting", "segmentation"]);
  assert.deepEqual(result.insightsByRef["owner/a"]?.llmCaveats, ["missing values", "sample bias", "high leakage risk"]);
});
