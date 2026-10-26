import app from "./app.js";
import { env } from "./config/env.js";
import { redis } from "./config/redis.js";

const PORT = env.PORT;

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

redis
    .ping()
    .then((result: string) => {
        console.log("Redis connection:", result);
    })
    .catch((error: Error) => {
        console.error("Redis ping failed:", error.message);
    });
