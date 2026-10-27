import { Router } from "express";

import { rateLimit } from "../middleware/rate-limit.middleware.js";
import {
    createUrl,
    deactivateUrl,
    getClickStatsHandler,
} from "../controllers/url.controller.js";

const router = Router();

router.post("/", rateLimit, createUrl);
router.get("/:shortCode/stats", getClickStatsHandler);
router.delete("/:shortCode", deactivateUrl);

export default router;
