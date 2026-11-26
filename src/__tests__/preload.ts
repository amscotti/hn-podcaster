// Test preload: seed placeholder keys so `bun test` runs without a `.env`.
// Real values from `.env` are preserved (only set when unset).
if (Bun.env.AI_PROVIDER === undefined) {
  Bun.env.AI_PROVIDER = "xai";
}
if (Bun.env.XAI_API_KEY === undefined) {
  Bun.env.XAI_API_KEY = "test-xai-key";
}
if (Bun.env.JINA_API_KEY === undefined) {
  Bun.env.JINA_API_KEY = "test-jina-key";
}
if (Bun.env.SKIP_AUDIO === undefined) {
  Bun.env.SKIP_AUDIO = "true";
}
