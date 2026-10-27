import type { Server } from "node:http";

type GracefulShutdownOptions = {
    /** HTTP server to stop accepting new requests on. */
    server: Server;
    /** Runs immediately on signal, before draining (e.g. stop timers). */
    onSignal?: () => void;
    /** Closes shared resources after in-flight requests finish (e.g. pools). */
    cleanup: () => Promise<unknown> | unknown;
    /** Force-exit delay in ms, as a safety net if draining hangs. */
    timeoutMs?: number;
};

/**
 * Wires SIGTERM/SIGINT handlers that shut the process down gracefully:
 * stop timers → stop accepting requests → finish in-flight ones →
 * close shared resources → exit. Used by container orchestrators
 * (Docker sends SIGTERM, then force-kills after its grace period).
 */
export function registerGracefulShutdown({
    server,
    onSignal,
    cleanup,
    timeoutMs = 10_000,
}: GracefulShutdownOptions): void {
    let isShuttingDown = false;

    const shutdown = (signal: string): void => {
        if (isShuttingDown) {
            return;
        }
        isShuttingDown = true;

        console.log(`Received ${signal}. Shutting down gracefully...`);
        onSignal?.();

        // Safety net: force exit if draining hangs (e.g. a stuck connection).
        const forceExit = setTimeout(() => process.exit(1), timeoutMs);
        forceExit.unref();

        server.close(() => {
            void Promise.allSettled([cleanup()]).finally(() => {
                console.log("Graceful shutdown complete.");
                process.exit(0);
            });
        });

        // Persistent keep-alive connections would otherwise hold server.close open.
        server.closeIdleConnections();
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
}
