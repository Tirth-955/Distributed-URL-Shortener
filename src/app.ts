import express from "express";

import { errorHandler } from "./middleware/error.middleware.js";
import urlRoutes from "./routes/url.routes.js";
import { redirectUrl } from "./controllers/url.controller.js";

const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
    res.status(200).json({
        status: "ok",
        message: "URL Shortener API is running",
    });
});

app.get("/:shortCode", redirectUrl);

app.use("/api/v1/urls", urlRoutes);

app.use(errorHandler);

export default app;
