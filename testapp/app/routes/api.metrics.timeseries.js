import { authenticate }    from "../shopify.server.js";
import { queryTimeseries } from "../lib/metrics/query.server.js";

export function createMetricsTimeseriesLoader({ authenticateAdmin, query }) {
  return async ({ request }) => {
    await authenticateAdmin(request);

    const url    = new URL(request.url);
    const metric = url.searchParams.get("metric") || "revenue";
    const bucket = url.searchParams.get("bucket") || "day";
    const range  = url.searchParams.get("range")  || "last_7d";
    const start  = url.searchParams.get("start")  || undefined;
    const end    = url.searchParams.get("end")    || undefined;
    const tz     = url.searchParams.get("tz")     || "UTC";

    try {
      const result = query({ metric, bucket, range, start, end, tz });
      return Response.json(result);
    } catch (err) {
      return Response.json({ error: err.message }, { status: 400 });
    }
  };
}

export const loader = createMetricsTimeseriesLoader({
  authenticateAdmin: authenticate.admin,
  query: queryTimeseries,
});
