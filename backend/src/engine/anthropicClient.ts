import Anthropic from "@anthropic-ai/sdk";

// Shared by every Claude-backed feature (label scanning, meal description).
// Lazily constructed so a missing ANTHROPIC_API_KEY doesn't crash the whole
// server at boot — only these features are unavailable, and each route turns
// a thrown error here into a clear 503 instead of an SDK stack trace.
let client: Anthropic | undefined;
export function getAnthropicClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  if (!client) client = new Anthropic();
  return client;
}
