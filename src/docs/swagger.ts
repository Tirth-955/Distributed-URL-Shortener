import type { Express } from "express";
import swaggerUi from "swagger-ui-express";

import { openapiSpec } from "./openapi.js";

export function mountSwagger(app: Express) {
    app.get("/openapi.json", (_req, res) => {
        res.status(200).json(openapiSpec);
    });

    app.use(
        "/docs",
        ...swaggerUi.serve,
        swaggerUi.setup(openapiSpec, {
            customSiteTitle: "Distributed URL Shortener API",
            swaggerOptions: {
                persistAuthorization: true,
                displayRequestDuration: true,
            },
        })
    );
}
