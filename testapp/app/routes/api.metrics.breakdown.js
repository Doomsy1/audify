import { authenticate }   from "../shopify.server.js";
import { queryBreakdown } from "../lib/metrics/query.server.js";

export function createMetricsBreakdownLoader({ authenticateAdmin, query }) {
  return async ({ request }) => {
    await authenticateAdmin(request);

    const url    = new URL(request.url);
    const metric = url.searchParams.get("metric") || "revenue";
    const by     = url.searchParams.get("by")     || "product";
    const range  = url.searchParams.get("range")  || "last_30d";
    const start  = url.searchParams.get("start")  || undefined;
    const end    = url.searchParams.get("end")    || undefined;
    const tz     = url.searchParams.get("tz")     || "UTC";

    try {
      const result = query({ metric, by, range, start, end, tz });
      return Response.json(result);
    } catch (err) {
      return Response.json({ error: err.message }, { status: 400 });
    }
  };
}

export const loader = createMetricsBreakdownLoader({
  authenticateAdmin: authenticate.admin,
  query: queryBreakdown,
});
