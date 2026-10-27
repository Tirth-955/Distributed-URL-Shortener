import app from "./app.js";
import { env } from "./config/env.js";
import { redis } from "./config/redis.js";
import { pool } from "./db/index.js";
import { flushClickCounts } from "./services/url-stats.service.js";
import { registerGracefulShutdown } from "./utils/graceful-shutdown.js";

const PORT = env.PORT;
const CLICK_FLUSH_INTERVAL_MS = 60_000;

const server = app.listen(PORT, () => {
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

registerGracefulShutdown({
    server,
    onSignal: () => clearInterval(flushTimer),
    cleanup: () => Promise.allSettled([redis.quit(), pool.end()]),
});
