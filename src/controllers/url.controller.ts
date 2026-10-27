import type { Request, Response, NextFunction } from "express";

import { env } from "../config/env.js";
import { createUrlSchema } from "../validators/url.validator.js";
import { createShortUrl } from "../services/url.service.js";
import { getUrlByShortCode } from "../services/url.service.js";

export async function createUrl(req: Request, res: Response, next: NextFunction) {
    const result = createUrlSchema.safeParse(req.body);

    if (!result.success) {
        return res.status(400).json({
            error: "Invalid request body",
            details: result.error.issues,
        });
    }

    try {
        const created = await createShortUrl(result.data.url, result.data.expiresInDays);

        const baseUrl = env.BASE_URL.replace(/\/+$/, "");
        const shortUrl = `${baseUrl}/${created.shortCode}`;

        return res.status(201).json({
            shortCode: created.shortCode,
            originalUrl: created.originalUrl,
            shortUrl,
            expiresAt: created.expiresAt,
        });
    } catch (error) {
        next(error);
    }
}

export async function redirectUrl(req: Request, res: Response, next: NextFunction) {
    try {
        const { shortCode } = req.params;

        if (typeof shortCode !== "string") {
            return res.status(400).json({
                error: "Invalid short code",
            });
        }

        const result = await getUrlByShortCode(shortCode);

        if (result.status === "not_found") {
            return res.status(404).json({
                error: "Short URL not found",
            });
        }

        if (result.status === "expired") {
            return res.status(410).json({
                error: "Short URL has expired",
            });
        }

        return res.redirect(302, result.originalUrl);
    } catch (error) {
        next(error);
    }
}
