import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types.js";
import { authRoutes } from "./routes/auth.js";
import { syncRoutes } from "./routes/sync.js";
import { rankRoutes } from "./routes/rankings.js";
import { usageRoute } from "./routes/usage.js";
import { pricingRoutes } from "./routes/pricing.js";
import { refreshPricingTable } from "./pricing-refresh.js";
import { dashboardRoute } from "./dashboard.js";
import { landingRoute } from "./landing.js";
import { inviteRoute } from "./invite.js";
import { guideRoute } from "./guide.js";
import { blogRoute } from "./blog.js";
import { guidesRoute } from "./guides.js";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", cors({ origin: "https://ccclub.dev" }));

app.get("/api/health", (c) => c.json({ status: "ok" }));

app.route("/api", authRoutes);
app.route("/api", syncRoutes);
app.route("/api", rankRoutes);
app.route("/api", pricingRoutes);
app.post("/api/usage", usageRoute);
app.route("/", landingRoute);
app.route("/", guideRoute);
app.route("/", blogRoute);
app.route("/", guidesRoute);
app.route("/", inviteRoute);
app.route("/", dashboardRoute);

export default {
  fetch: app.fetch,
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(refreshPricingTable(env));
  },
};
