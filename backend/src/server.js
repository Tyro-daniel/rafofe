require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth.routes");
const kycRoutes = require("./routes/kyc.routes");
const loanRoutes = require("./routes/loans.routes");
const servicingRoutes = require("./routes/servicing.routes");
const officerRoutes = require("./routes/officer.routes");

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:5173" }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

app.use("/auth", authRoutes);
app.use("/kyc", kycRoutes);
app.use("/loans", loanRoutes);
app.use("/loans", servicingRoutes); // shares the /loans/accounts/* namespace
app.use("/officer", officerRoutes);

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` });
});

// Centralized error handler — catches anything thrown/rejected in a route
// that wasn't already handled with its own try/catch (defense in depth;
// most routes above already handle their own errors explicitly).
app.use((err, req, res, _next) => {
  console.error(err);
  if (err.message && err.message.includes("Only PDF, JPEG, or PNG")) {
    return res.status(400).json({ error: err.message });
  }
  res.status(err.statusCode || 500).json({ error: err.message || "Internal server error" });
});

// Last-resort safety net. Every route handler is now wrapped in
// asyncHandler (see src/utils/asyncHandler.js), so this should never fire
// from normal request handling — but it guards against anything outside
// the request/response cycle (e.g. a rejected promise in setup code)
// silently killing the process with no log line at all.
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED PROMISE REJECTION (this should not happen — please report):", reason);
});
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION (this should not happen — please report):", err);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`LMS backend listening on http://localhost:${PORT}`);
});
