export class ShortCodeTakenError extends Error {
    constructor(shortCode: string) {
        super(`Short code "${shortCode}" is already in use`);
        this.name = "ShortCodeTakenError";
    }
}
