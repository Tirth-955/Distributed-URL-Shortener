import { Router } from "express";

import { rateLimit } from "../middleware/rate-limit.middleware.js";
import { createUrl } from "../controllers/url.controller.js";

const router = Router();

router.post("/", rateLimit, createUrl);

export default router;
