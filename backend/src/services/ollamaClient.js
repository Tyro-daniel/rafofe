  /**
 * Low-level client for the local Ollama server. This file's only job is
 * "talk to Ollama correctly" — no RAG, no prompt engineering, no
 * business logic. Those live in higher-level services (aiAssistant.js,
 * built in a later sprint) that call this one.
 *
 * CONFIG: base URL and model name come from environment variables, not
 * hardcoded — same convention as every other external integration in
 * this codebase (SMTP, database). This matters practically too: the
 * model name in your original snippet ("qwen3") may not match what
 * `ollama pull` actually gave you locally (Qwen3 ships in several
 * sizes — qwen3:0.6b, qwen3:4b, qwen3:8b, etc.). Run `ollama list` on
 * your machine to see the exact tag you have, and set OLLAMA_MODEL to
 * match exactly — Ollama will 404 on a tag that doesn't exist locally.
 *
 * CORRECTNESS FIX vs. the original snippet: Ollama's /api/chat endpoint
 * streams its response by default (newline-delimited JSON chunks, not
 * one JSON object). A plain axios.post() against a streaming response
 * will NOT give you a clean `response.data.message.content` the way
 * the original snippet assumed — you'd get either a parse error or an
 * incomplete/garbled result depending on axios's handling of the
 * chunked body. Fixed here by explicitly passing `stream: false`, which
 * tells Ollama to buffer and return one complete JSON object instead.
 */
const axios = require("axios");

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3";
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 60000); // LLM responses are slow — 60s default, not axios's default (which is "no timeout" — worse) or a too-short one that kills a real answer mid-generation

const client = axios.create({
  baseURL: OLLAMA_BASE_URL,
  timeout: OLLAMA_TIMEOUT_MS,
});

/** Thrown for every failure mode below, so callers can catch ONE error
 * type instead of branching on axios internals. `cause` preserves the
 * original error for logging/debugging without leaking raw axios
 * details into whatever the caller does with the message. */
class OllamaError extends Error {
  constructor(message, { cause, code } = {}) {
    super(message);
    this.name = "OllamaError";
    this.code = code || "OLLAMA_ERROR"; // machine-readable, for the route layer to branch on later
    if (cause) this.cause = cause;
  }
}

/**
 * Low-level chat call. `messages` follows Ollama/OpenAI-style shape:
 * [{ role: "system"|"user"|"assistant", content: "..." }, ...]
 * Designed to accept a full conversation (and, later, a system-prompt
 * message carrying RAG context) rather than a single string — this is
 * what makes it a clean foundation for the RAG sprint later, without
 * needing to change this file again.
 */
async function chat(messages, { model = OLLAMA_MODEL, temperature } = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new OllamaError("messages must be a non-empty array", { code: "INVALID_INPUT" });
  }

  let response;
  try {
    response = await client.post("/api/chat", {
      model,
      messages,
      stream: false, // see file header — critical, not optional
      ...(temperature !== undefined ? { options: { temperature } } : {}),
    });
  } catch (err) {
    if (err.code === "ECONNREFUSED") {
      throw new OllamaError(
        `Could not reach Ollama at ${OLLAMA_BASE_URL}. Is "ollama serve" running?`,
        { cause: err, code: "OLLAMA_UNREACHABLE" }
      );
    }
    if (err.code === "ECONNABORTED") {
      throw new OllamaError(
        `Ollama did not respond within ${OLLAMA_TIMEOUT_MS}ms.`,
        { cause: err, code: "OLLAMA_TIMEOUT" }
      );
    }
    if (err.response) {
      // Ollama itself returned an error status — most commonly a 404 for
      // a model tag that isn't actually pulled locally.
      const detail = err.response.data?.error || err.response.statusText;
      throw new OllamaError(
        `Ollama returned ${err.response.status}: ${detail}`,
        { cause: err, code: "OLLAMA_BAD_RESPONSE" }
      );
    }
    throw new OllamaError(`Unexpected error calling Ollama: ${err.message}`, { cause: err });
  }

  const content = response.data?.message?.content;
  if (typeof content !== "string") {
    throw new OllamaError(
      "Ollama responded, but not in the expected shape (missing message.content).",
      { code: "OLLAMA_MALFORMED_RESPONSE" }
    );
  }

  return content;
}

/** Convenience wrapper for a single one-off question — this is the
 * direct equivalent of the askAI() function from the original snippet,
 * kept as the simple entry point for straightforward use. */
async function askAI(prompt) {
  return chat([{ role: "user", content: prompt }]);
}

module.exports = { chat, askAI, OllamaError, OLLAMA_BASE_URL, OLLAMA_MODEL };
