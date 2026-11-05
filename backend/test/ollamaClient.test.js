/**
 * Redirects the "axios" import to our stub BEFORE requiring
 * ollamaClient, so every test in this file runs against the fake HTTP
 * layer instead of making a real network call. This makes `npm test`
 * fully self-contained — it never depends on Ollama actually running.
 */
const Module = require("module");
const path = require("path");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "axios") return path.resolve(__dirname, "mocks/axios-stub.cjs");
  return originalResolve.call(this, request, ...args);
};

const test = require("node:test");
const assert = require("node:assert/strict");
const axiosStub = require("./mocks/axios-stub.cjs");
const { chat, askAI, OllamaError } = require("../src/services/ollamaClient");

test("askAI sends the correct request shape, with stream:false explicitly set", async () => {
  axiosStub.__setMode("success");
  const answer = await askAI("What is the interest rate on the Small Micro Loan?");
  const sent = axiosStub.__getLastPostArgs();

  assert.equal(sent.url, "/api/chat");
  assert.equal(sent.body.stream, false, "stream must be explicitly false — Ollama streams by default otherwise");
  assert.equal(sent.body.messages[0].role, "user");
  assert.equal(sent.body.messages[0].content, "What is the interest rate on the Small Micro Loan?");
  assert.equal(answer, "This is a stubbed AI response.");
});

test("connection refused (Ollama not running) throws a clear, typed, actionable error", async () => {
  axiosStub.__setMode("econnrefused");
  await assert.rejects(
    () => askAI("hello"),
    (err) => {
      assert.ok(err instanceof OllamaError);
      assert.equal(err.code, "OLLAMA_UNREACHABLE");
      assert.match(err.message, /ollama serve/);
      return true;
    }
  );
});

test("timeout throws a clear OLLAMA_TIMEOUT error", async () => {
  axiosStub.__setMode("timeout");
  await assert.rejects(() => askAI("hello"), (err) => {
    assert.equal(err.code, "OLLAMA_TIMEOUT");
    return true;
  });
});

test("a 404 (e.g. wrong or unpulled model tag) surfaces Ollama's own error detail", async () => {
  axiosStub.__setMode("http404");
  await assert.rejects(() => askAI("hello"), (err) => {
    assert.equal(err.code, "OLLAMA_BAD_RESPONSE");
    assert.match(err.message, /model 'qwen3' not found/);
    return true;
  });
});

test("a malformed response shape is caught explicitly, never silently returns undefined", async () => {
  axiosStub.__setMode("malformed");
  await assert.rejects(() => askAI("hello"), (err) => {
    assert.equal(err.code, "OLLAMA_MALFORMED_RESPONSE");
    return true;
  });
});

test("chat() rejects an empty messages array before making any network call", async () => {
  await assert.rejects(() => chat([]), (err) => {
    assert.equal(err.code, "INVALID_INPUT");
    return true;
  });
});
