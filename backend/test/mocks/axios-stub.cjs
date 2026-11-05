/**
 * Test double for axios, used only by ollamaClient.test.js. Records the
 * last request made and can simulate every real failure mode Ollama
 * integration can hit (unreachable, timeout, bad model tag, malformed
 * response) without needing a live Ollama server during `npm test`.
 */
let mode = "success";
let lastPostArgs = null;

function makeError(code, extra = {}) {
  const err = new Error(extra.message || "stubbed error");
  err.code = code;
  if (extra.response) err.response = extra.response;
  return err;
}

const instance = {
  post: async (url, body) => {
    lastPostArgs = { url, body };
    if (mode === "econnrefused") throw makeError("ECONNREFUSED");
    if (mode === "timeout") throw makeError("ECONNABORTED");
    if (mode === "http404") {
      throw makeError(undefined, {
        response: { status: 404, statusText: "Not Found", data: { error: "model 'qwen3' not found, try pulling it first" } },
      });
    }
    if (mode === "malformed") return { data: { some: "unexpected shape" } };
    return { data: { message: { role: "assistant", content: "This is a stubbed AI response." } } };
  },
};

module.exports = {
  create: () => instance,
  __setMode: (m) => { mode = m; },
  __getLastPostArgs: () => lastPostArgs,
};
