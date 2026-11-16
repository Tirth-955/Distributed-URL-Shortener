import { describe, expect, it } from "vitest";

import { decodeCursor, encodeCursor } from "../src/utils/cursor.js";

describe("cursor codec", () => {
    it("round-trips a (createdAt, id) pair", () => {
        const createdAt = new Date("2026-11-13T10:00:00.000Z");

        const decoded = decodeCursor(encodeCursor(createdAt, 42))!;

        expect(decoded.createdAt.toISOString()).toBe(createdAt.toISOString());
        expect(decoded.id).toBe(42);
    });

    it("returns null for a token without the id part", () => {
        expect(decodeCursor(Buffer.from("only-a-date", "utf8").toString("base64url"))).toBeNull();
    });

    it("returns null for a non-numeric id", () => {
        expect(decodeCursor(Buffer.from("2026-11-13T10:00:00.000Z|abc", "utf8").toString("base64url"))).toBeNull();
    });

    it("returns null for an unparseable date", () => {
        expect(decodeCursor(Buffer.from("not-a-date|42", "utf8").toString("base64url"))).toBeNull();
    });

    it("returns null for an empty token", () => {
        expect(decodeCursor("")).toBeNull();
    });
});
