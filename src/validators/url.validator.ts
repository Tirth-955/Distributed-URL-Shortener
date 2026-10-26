import { z } from "zod";

export const createUrlSchema = z.object({
    url: z
        .string()
        .url("Please provide a valid URL")
        .pipe(
            z.string().refine((value) => {
                try {
                    const protocol = new URL(value).protocol;
                    return protocol === "http:" || protocol === "https:";
                } catch {
                    return false;
                }
            }, "Only HTTP and HTTPS URLs are allowed")
        ),

    expiresInDays: z
        .number()
        .int()
        .min(1, "Expiration must be at least 1 day")
        .max(365, "Expiration cannot exceed 365 days")
        .optional(),
});

export type CreateUrlInput = z.infer<typeof createUrlSchema>;
