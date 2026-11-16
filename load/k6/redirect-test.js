import http from "k6/http";
import { check, sleep } from "k6";

// Load-test the public redirect path. One scenario runs per invocation,
// selected with SCENARIO=cached|uncached; load/run-matrix.ps1 executes the
// full cached-vs-uncached x 1-vs-3-replica matrix and records RPS/p95/p99.
//
//   cached   - a handful of hot codes, steady traffic: after the first hit
//              every redirect is served from Redis (cache-aside hot path).
//   uncached - a fresh nonexistent code per request: every request is a
//              Redis miss that falls through to Postgres (cold path).

const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
const API_KEY = __ENV.API_KEY || "";
const SCENARIO = __ENV.SCENARIO || "cached";
const VUS = Number(__ENV.VUS || 50);
const DURATION = __ENV.DURATION || "30s";
const SLEEP_SECONDS = Number(__ENV.SLEEP_MS || 0) / 1000;
const REPLICAS = __ENV.REPLICAS || "";
const RESULTS_JSON = __ENV.RESULTS_JSON || "";

const HOT_CODE_COUNT = 5;

function randomSuffix() {
    return Math.random().toString(36).slice(2, 10);
}

export const options = {
    scenarios: {
        [SCENARIO]: {
            executor: "constant-vus",
            vus: VUS,
            duration: DURATION,
            exec: SCENARIO === "cached" ? "cachedScenario" : "uncachedScenario",
        },
    },
    // k6 only emits p(90)/p(95) by default; request the stats the summary
    // JSON needs (RPS, p50/p95/p99).
    summaryTrendStats: ["avg", "min", "med", "max", "p(50)", "p(95)", "p(99)"],
    // Pure recording harness: no thresholds, so the exit code only reflects
    // transport errors, not performance gates.
};

export function setup() {
    if (SCENARIO !== "cached") {
        return { hotCodes: [] };
    }

    if (!API_KEY) {
        throw new Error("API_KEY env var is required for the cached scenario");
    }

    const headers = { "Content-Type": "application/json", "X-API-Key": API_KEY };
    const suffix = Date.now().toString(36);
    const hotCodes = [];

    for (let i = 0; i < HOT_CODE_COUNT; i += 1) {
        const res = http.post(
            `${BASE_URL}/api/v1/urls`,
            JSON.stringify({
                url: "https://github.com/trending",
                customCode: `ld${suffix}${i}`,
            }),
            { headers, redirects: 0, tags: { name: "setup" } }
        );

        check(res, { "hot code created (201)": (r) => r.status === 201 });

        if (res.status === 201) {
            const code = res.json("shortCode");
            hotCodes.push(code);
            // Warm the cache entry for this code.
            http.get(`${BASE_URL}/${code}`, { redirects: 0, tags: { name: "setup" } });
        }
    }

    if (hotCodes.length === 0) {
        throw new Error("Could not create any hot codes for the cached scenario");
    }

    return { hotCodes };
}

export function cachedScenario(data) {
    const code = data.hotCodes[Math.floor(Math.random() * data.hotCodes.length)];

    const res = http.get(`${BASE_URL}/${code}`, {
        redirects: 0,
        tags: { name: "redirect-cached" },
    });

    check(res, { "status is 302": (r) => r.status === 302 });

    if (SLEEP_SECONDS > 0) {
        sleep(SLEEP_SECONDS);
    }
}

export function uncachedScenario() {
    const code = `nc${randomSuffix()}`;

    const res = http.get(`${BASE_URL}/${code}`, {
        redirects: 0,
        tags: { name: "redirect-uncached" },
    });

    check(res, { "status is 404": (r) => r.status === 404 });

    if (SLEEP_SECONDS > 0) {
        sleep(SLEEP_SECONDS);
    }
}

export function handleSummary(data) {
    const values = data.metrics.http_req_duration.values;
    const summary = {
        replicas: REPLICAS === "" ? null : Number(REPLICAS),
        scenario: SCENARIO,
        vus: VUS,
        duration: DURATION,
        rps: data.metrics.http_reqs.values.rate,
        requests: data.metrics.http_reqs.values.count,
        avgMs: values.avg,
        p50Ms: values["p(50)"],
        p95Ms: values["p(95)"],
        p99Ms: values["p(99)"],
        maxMs: values.max,
    };

    function fmt(ms) {
        return ms === undefined ? "n/a" : ms.toFixed(1);
    }

    const out = {};

    if (RESULTS_JSON) {
        out[RESULTS_JSON] = JSON.stringify(summary, null, 2);
    }

    out.stdout = [
        "",
        `scenario=${summary.scenario} replicas=${summary.replicas} vus=${summary.vus}`,
        `rps=${summary.rps.toFixed(1)}  p50=${fmt(summary.p50Ms)}  p95=${fmt(summary.p95Ms)}  p99=${fmt(summary.p99Ms)}  (ms)`,
        "",
    ].join("\n");

    return out;
}
