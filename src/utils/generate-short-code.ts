import { randomBytes } from "node:crypto";

export function generateShortCode(): string {
    return randomBytes(6).toString("base64url");
}
