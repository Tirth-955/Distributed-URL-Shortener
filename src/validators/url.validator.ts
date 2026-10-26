import { z } from "zod";

export const createUrlSchema = z.object({
    url: z
        .string()
        .url("Please provide a valid URL")
        .refine((value) => {
            const protocol = new URL(value).protocol;
            return protocol === "http:" || protocol === "https:";
        }, "Only HTTP and HTTPS URLs are allowed"),
});

export type CreateUrlInput = z.infer<typeof createUrlSchema>;
