import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types.js";
import { authRoutes } from "./routes/auth.js";
import { syncRoutes } from "./routes/sync.js";
import { rankRoutes } from "./routes/rankings.js";
import { dashboardRoute } from "./dashboard.js";
import { landingRoute } from "./landing.js";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", cors());

app.get("/api/health", (c) => c.json({ status: "ok" }));

app.route("/api", authRoutes);
app.route("/api", syncRoutes);
app.route("/api", rankRoutes);
app.route("/", landingRoute);
app.route("/", dashboardRoute);

export default app;
