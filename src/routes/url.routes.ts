import { Router } from "express";

import { rateLimit } from "../middleware/rate-limit.middleware.js";
import { requireApiKey } from "../middleware/auth.middleware.js";
import {
    createUrl,
    deactivateUrl,
    getClickStatsHandler,
} from "../controllers/url.controller.js";

const router = Router();

router.post("/", rateLimit, requireApiKey, createUrl);
router.get("/:shortCode/stats", requireApiKey, getClickStatsHandler);
router.delete("/:shortCode", requireApiKey, deactivateUrl);

export default router;
