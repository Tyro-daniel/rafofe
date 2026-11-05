const Module = require("module");
const path = require("path");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "axios") return path.resolve(__dirname, "axios-stub.cjs");
  return originalResolve.call(this, request, ...args);
};
