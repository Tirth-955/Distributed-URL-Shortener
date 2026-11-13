import type { Request, Response, NextFunction } from "express";

import { createApiKey } from "../services/api-key.service.js";

export async function createApiKeyHandler(req: Request, res: Response, next: NextFunction) {
    try {
        const created = await createApiKey();

        return res.status(201).json({
            apiKey: created.apiKey,
            keyPrefix: created.keyPrefix,
            note: "Store this key securely - it is shown only once and cannot be recovered.",
        });
    } catch (error) {
        next(error);
    }
}
