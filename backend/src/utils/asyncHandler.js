/**
 * Express 4 does NOT automatically catch errors thrown/rejected inside an
 * `async` route handler — an unhandled rejection in a route handler becomes
 * a process-level unhandled rejection, and Node terminates the process by
 * default (since Node 15). That crashes the server on ANY unexpected DB
 * error, not just bugs — which is exactly what "curl: Empty reply from
 * server" looks like from the client side.
 *
 * Wrap every async route handler with this so errors are forwarded to
 * Express's error-handling middleware (see server.js) instead of crashing
 * the process. This is the standard pattern for Express 4 without pulling
 * in a dependency like express-async-errors.
 *
 * Usage: router.get("/x", asyncHandler(async (req, res) => { ... }));
 */
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
