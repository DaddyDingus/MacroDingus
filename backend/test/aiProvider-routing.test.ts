import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_TASKS,
  generateAiText,
  type AiImageInput,
  type AiTask,
} from "../src/engine/aiProvider.js";

interface CapturedRequest {
  capability: string;
  input: { text: string; images?: { mimeType: string; dataBase64: string }[] };
  parameters: Record<string, unknown>;
  maxOutputTokens: number;
}

const image: AiImageInput = {
  buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  mediaType: "image/jpeg",
};

const scenarios: readonly {
  task: AiTask;
  images?: AiImageInput[];
  expectedCapability: "general" | "complex_reasoning" | "vision";
}[] = [
  { task: "foodLookup", expectedCapability: "general" },
  { task: "checkinNarrative", expectedCapability: "general" },
  { task: "mealDescription", expectedCapability: "complex_reasoning" },
  { task: "recipeImport", expectedCapability: "complex_reasoning" },
  { task: "labelScan", images: [image], expectedCapability: "vision" },
  { task: "recipePhotoImport", images: [image], expectedCapability: "vision" },
  { task: "photoComparison", images: [image, image], expectedCapability: "vision" },
];

test("maps food lookup to general without changing other AI feature routes", async () => {
  assert.deepEqual(
    [...new Set(scenarios.map(({ task }) => task))].sort(),
    [...AI_TASKS].sort(),
    "the regression table must cover every MacroDaddy AI task",
  );

  const originalFetch = globalThis.fetch;
  const originalOrigin = process.env.AI_GATEWAY_ORIGIN;
  const captured: { url: string; init: RequestInit; body: CapturedRequest }[] = [];
  process.env.AI_GATEWAY_ORIGIN = "https://gateway.invalid";
  globalThis.fetch = (async (input, init) => {
    assert.ok(init);
    const body = JSON.parse(String(init.body)) as CapturedRequest;
    captured.push({ url: String(input), init, body });
    return new Response(JSON.stringify({ data: { output: { type: "text", text: "{}" } } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    for (const scenario of scenarios) {
      await generateAiText("test-access-token", scenario.task, {
        prompt: `test ${scenario.task}`,
        images: scenario.images,
        ...(scenario.task === "foodLookup"
          ? { jsonSchema: { type: "object", properties: {} }, maxTokens: 900 }
          : { maxTokens: 100 }),
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOrigin === undefined) delete process.env.AI_GATEWAY_ORIGIN;
    else process.env.AI_GATEWAY_ORIGIN = originalOrigin;
  }

  assert.equal(captured.length, scenarios.length);
  for (const [index, scenario] of scenarios.entries()) {
    const request = captured[index]!;
    assert.equal(request.url, "https://gateway.invalid/api/ai/v1/tasks");
    assert.equal(request.body.capability, scenario.expectedCapability, scenario.task);
    assert.deepEqual(request.body.parameters, {});
    assert.equal("provider" in request.body, false);
    assert.equal("model" in request.body, false);

    const headers = new Headers(request.init.headers);
    assert.equal(headers.get("Authorization"), "Bearer test-access-token");
    assert.match(
      headers.get("Idempotency-Key") ?? "",
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  }

  const foodLookup = captured[0]!.body;
  assert.equal(foodLookup.maxOutputTokens, 4_900);
  assert.match(foodLookup.input.text, /Return only one valid JSON object/);
  assert.match(foodLookup.input.text, /JSON Schema/);

  for (const request of captured.slice(4)) {
    assert.deepEqual(request.body.input.images, scenarioImages(request.body.input.images?.length ?? 0));
  }
});

function scenarioImages(count: number): { mimeType: string; dataBase64: string }[] {
  return Array.from({ length: count }, () => ({
    mimeType: "image/jpeg",
    dataBase64: image.buffer.toString("base64"),
  }));
}
