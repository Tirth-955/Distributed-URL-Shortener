import type { Request, Response, NextFunction } from "express";
import { createUrlSchema } from "../validators/url.validator.js";
import { createShortUrl } from "../services/url.service.js";
import { env } from "../config/env.js";

export async function createUrl(req: Request, res: Response, next: NextFunction) {
    const result = createUrlSchema.safeParse(req.body);

    if (!result.success) {
        return res.status(400).json({
            error: "Invalid request body",
            details: result.error.issues,
        });
    }

    try {
        const created = await createShortUrl(result.data.url);

        const baseUrl = (env.BASE_URL ?? `${req.protocol}://${req.get("host")}`).replace(
            /\/+$/,
            ""
        );

        return res.status(201).json({
            ...created,
            shortUrl: `${baseUrl}/${created.shortCode}`,
        });
    } catch (error) {
        next(error);
    }
}
