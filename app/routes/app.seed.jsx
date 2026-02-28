import { authenticate, apiVersion } from "../shopify.server";
import { useFetcher } from "react-router";
import { useEffect, useRef, useState } from "react";

// Creates exactly ONE order for a given day offset (0 = today, 29 = 29 days ago).
// Called repeatedly by the client with a delay between each call.
export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();
  const day = parseInt(fd.get("day"), 10);

  const now = new Date();
  const date = new Date(now);
  date.setDate(date.getDate() - day);

  const price = (20 + ((day * 17 + Math.floor(day / 3) * 31) % 480)).toFixed(2);

  const res = await fetch(
    `https://${session.shop}/admin/api/${apiVersion}/orders.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": session.accessToken,
      },
      body: JSON.stringify({
        order: {
          line_items: [{ title: "Seed Product", price, quantity: 1 }],
          financial_status: "paid",
          created_at: date.toISOString(),
          processed_at: date.toISOString(),
        },
      }),
    }
  );

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("Retry-After") ?? "62", 10);
    return { ok: false, rateLimited: true, retryAfter, day };
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, rateLimited: false, day, error: String(body.errors) };
  }

  return { ok: true, day };
};

// ── Constants ─────────────────────────────────────────────────────────────────

const TOTAL_DAYS = 30;
// 14 s between orders ≈ 4/min — comfortably under the dev-store limit
const DELAY_BETWEEN_MS = 14_000;

// ── Component ─────────────────────────────────────────────────────────────────

export default function Seed() {
  const fetcher = useFetcher();
  const timerRef = useRef(null);

  const [status, setStatus] = useState({
    running: false,
    done: false,
    created: 0,
    countdown: 0,
    error: null,
  });

  // Submit one order for `day`
  const submitDay = (day) =>
    fetcher.submit({ day: String(day) }, { method: "post" });

  // Kick off the whole sequence
  const start = () => {
    setStatus({ running: true, done: false, created: 0, countdown: 0, error: null });
    submitDay(TOTAL_DAYS - 1);
  };

  // React to each action response
  useEffect(() => {
    const data = fetcher.data;
    if (!data) return;

    clearInterval(timerRef.current);

    if (data.rateLimited) {
      // Retry the same day after Retry-After seconds
      scheduleCountdown((data.retryAfter + 3) * 1000, () => submitDay(data.day));
      return;
    }

    if (!data.ok) {
      setStatus((s) => ({ ...s, running: false, error: data.error ?? "Unknown error" }));
      return;
    }

    // Success — advance to the next day
    const nextDay = data.day - 1;
    setStatus((s) => ({ ...s, created: s.created + 1, countdown: 0 }));

    if (nextDay < 0) {
      setStatus((s) => ({ ...s, running: false, done: true }));
      return;
    }

    scheduleCountdown(DELAY_BETWEEN_MS, () => submitDay(nextDay));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  // Countdown helper: ticks every second, fires callback when done
  function scheduleCountdown(totalMs, onDone) {
    const end = Date.now() + totalMs;
    timerRef.current = setInterval(() => {
      const remaining = Math.ceil((end - Date.now()) / 1000);
      if (remaining <= 0) {
        clearInterval(timerRef.current);
        setStatus((s) => ({ ...s, countdown: 0 }));
        onDone();
      } else {
        setStatus((s) => ({ ...s, countdown: remaining }));
      }
    }, 500);
  }

  // Cleanup on unmount
  useEffect(() => () => clearInterval(timerRef.current), []);

  const pct = Math.round((status.created / TOTAL_DAYS) * 100);
  const fetching = fetcher.state !== "idle";

  return (
    <div style={{ padding: 20, maxWidth: 480 }}>
      <h2 style={{ marginTop: 0 }}>Seed Test Orders</h2>
      <p style={{ fontSize: 13, color: "#666", marginTop: 0 }}>
        Creates 1 order/day for {TOTAL_DAYS} days. Fires one request at a time
        with a {DELAY_BETWEEN_MS / 1000}s gap to respect the dev-store rate
        limit (~7 min total). Leave this tab open.
      </p>

      {!status.running && !status.done && (
        <button
          onClick={start}
          style={{
            padding: "8px 28px",
            background: "#008060",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          ▶ Start Seeding
        </button>
      )}

      {(status.running || status.done) && (
        <>
          {/* Progress bar */}
          <div
            style={{
              background: "#e4e5e7",
              borderRadius: 4,
              overflow: "hidden",
              marginBottom: 6,
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: 10,
                background: status.done ? "#008060" : "#5c6ac4",
                transition: "width 0.4s",
              }}
            />
          </div>

          {/* Status line */}
          <div style={{ fontSize: 13, color: "#555" }}>
            {status.created}/{TOTAL_DAYS} orders
            {fetching && " — creating…"}
            {!fetching && status.running && status.countdown > 0 &&
              ` — next in ${status.countdown}s`}
          </div>
        </>
      )}

      {status.done && (
        <div style={{ marginTop: 12, fontWeight: 600, color: "#008060" }}>
          ✓ Done!{" "}
          <a href="/app/sonify" style={{ color: "#5c6ac4" }}>
            → Go to Sonify
          </a>
        </div>
      )}

      {status.error && (
        <div style={{ marginTop: 8, color: "#de3618", fontSize: 12 }}>
          Error: {status.error}
        </div>
      )}
    </div>
  );
}
