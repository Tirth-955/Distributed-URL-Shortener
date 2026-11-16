import os from "node:os";
import express from "express";

import { errorHandler } from "./middleware/error.middleware.js";
import { redirectRateLimit } from "./middleware/rate-limit.middleware.js";
import urlRoutes from "./routes/url.routes.js";
import keyRoutes from "./routes/key.routes.js";
import { redirectUrl } from "./controllers/url.controller.js";
import { mountSwagger } from "./docs/swagger.js";

const app = express();

// When running behind a load balancer (nginx), trust the first proxy hop so
// req.ip is the real client IP instead of the proxy IP. Without this, the
// Redis rate limiter would count all clients as one.
app.set("trust proxy", 1);

app.use(express.json());

app.get("/health", (_req, res) => {
    res.status(200).json({
        status: "ok",
        message: "URL Shortener API is running",
        instance: os.hostname(),
    });
});

app.use("/api/v1/urls", urlRoutes);
app.use("/api/v1/keys", keyRoutes);

mountSwagger(app);

app.get("/:shortCode", redirectRateLimit, redirectUrl);

app.use(errorHandler);

export default app;
