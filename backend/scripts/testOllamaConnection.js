/**
 * Standalone smoke test — run this YOURSELF against your real, running
 * Ollama instance (I can't reach your localhost:11434 from here, so
 * this is the step that actually proves the live connection works).
 *
 * Run with:
 *   cd backend
 *   node scripts/testOllamaConnection.js
 */
require("dotenv").config();
const { askAI, OLLAMA_BASE_URL, OLLAMA_MODEL } = require("../src/services/ollamaClient");

async function main() {
  console.log(`Testing connection to Ollama at ${OLLAMA_BASE_URL}, model "${OLLAMA_MODEL}"...`);
  console.log("(If this hangs or errors, run `ollama list` first to confirm your exact model tag,");
  console.log(" and `ollama serve` to confirm the server is actually running.)\n");

  try {
    const answer = await askAI("In one short sentence, confirm you're working correctly.");
    console.log("✅ SUCCESS — Ollama responded:\n");
    console.log(answer);
  } catch (err) {
    console.error("❌ FAILED:", err.message);
    if (err.code) console.error("   Error code:", err.code);
    process.exit(1);
  }
}

main();
