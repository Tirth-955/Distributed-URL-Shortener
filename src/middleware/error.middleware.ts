import type { ErrorRequestHandler } from "express";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (res.headersSent) {
        return _next(error);
    }

    console.error(error);

    if (error instanceof SyntaxError && "status" in error && error.status === 400) {
        return res.status(400).json({
            error: "Invalid JSON in request body",
        });
    }

    res.status(500).json({
        error: "Internal server error",
    });
};
