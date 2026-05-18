import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types.js";
import { authRoutes } from "./routes/auth.js";
import { syncRoutes } from "./routes/sync.js";
import { rankRoutes } from "./routes/rankings.js";
import { usageRoute } from "./routes/usage.js";
import { dashboardRoute } from "./dashboard.js";
import { landingRoute } from "./landing.js";
import { inviteRoute } from "./invite.js";
import { guideRoute } from "./guide.js";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", cors({ origin: "https://ccclub.dev" }));

app.get("/api/health", (c) => c.json({ status: "ok" }));

app.route("/api", authRoutes);
app.route("/api", syncRoutes);
app.route("/api", rankRoutes);
app.post("/api/usage", usageRoute);
app.route("/", landingRoute);
app.route("/", guideRoute);
app.route("/", inviteRoute);
app.route("/", dashboardRoute);

export default app;
