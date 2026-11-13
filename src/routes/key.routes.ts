import { Router } from "express";

import { createKeyRateLimit } from "../middleware/rate-limit.middleware.js";
import { createApiKeyHandler } from "../controllers/api-key.controller.js";

const router = Router();

router.post("/", createKeyRateLimit, createApiKeyHandler);

export default router;
