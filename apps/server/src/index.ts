import cors from "cors";
import express from "express";
import {
  DEFAULT_CODEX_SESSIONS_DIR,
  listRecentCodexSessions,
  summariseCodexSessions,
} from "@tokenmeter/core/codex";

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "tokenmeter-server",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/providers/codex/overview", async (req, res) => {
  const limit = Math.max(
    1,
    Math.min(25, Number.parseInt(String(req.query.limit ?? "12"), 10) || 12),
  );

  try {
    const sessions = await listRecentCodexSessions({ limit });
    const summary = summariseCodexSessions(sessions);

    res.json({
      provider: "codex",
      generatedAt: new Date().toISOString(),
      sessionsDir: DEFAULT_CODEX_SESSIONS_DIR,
      ...summary,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";

    res.status(500).json({
      provider: "codex",
      generatedAt: new Date().toISOString(),
      error: message,
    });
  }
});

app.listen(port, () => {
  console.log(`TokenMeter server listening on http://localhost:${port}`);
});
