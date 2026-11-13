import { Router } from "express";

import { manageRateLimit } from "../middleware/rate-limit.middleware.js";
import { requireApiKey } from "../middleware/auth.middleware.js";
import {
    createUrl,
    deactivateUrl,
    getClickStatsHandler,
    listUrls,
} from "../controllers/url.controller.js";

const router = Router();

router.post("/", requireApiKey, manageRateLimit, createUrl);
router.get("/", requireApiKey, manageRateLimit, listUrls);
router.get("/:shortCode/stats", requireApiKey, manageRateLimit, getClickStatsHandler);
router.delete("/:shortCode", requireApiKey, manageRateLimit, deactivateUrl);

export default router;
