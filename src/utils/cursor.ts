export type UrlCursor = {
    createdAt: Date;
    id: number;
};

export function encodeCursor(createdAt: Date, id: number): string {
    return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString("base64url");
}

export function decodeCursor(token: string): UrlCursor | null {
    const parts = Buffer.from(token, "base64url").toString("utf8").split("|");

    if (parts.length !== 2) {
        return null;
    }

    const createdAt = new Date(parts[0]);
    const id = Number(parts[1]);

    if (Number.isNaN(createdAt.getTime()) || !Number.isInteger(id)) {
        return null;
    }

    return { createdAt, id };
}
