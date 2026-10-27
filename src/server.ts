import app from "./app.js";
import { env } from "./config/env.js";
import { redis } from "./config/redis.js";
import { flushClickCounts } from "./services/url-stats.service.js";

const PORT = env.PORT;
const CLICK_FLUSH_INTERVAL_MS = 60_000;

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

// Periodically merge pending Redis click counters into Postgres.
const flushTimer = setInterval(() => {
    void flushClickCounts();
}, CLICK_FLUSH_INTERVAL_MS);
flushTimer.unref();
