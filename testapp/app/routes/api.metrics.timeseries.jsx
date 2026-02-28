import { authenticate }    from "../shopify.server";
import { queryTimeseries } from "../lib/metrics/query.server.js";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const url    = new URL(request.url);
  const metric = url.searchParams.get("metric") || "revenue";
  const bucket = url.searchParams.get("bucket") || "day";
  const range  = url.searchParams.get("range")  || "last_7d";
  const start  = url.searchParams.get("start")  || undefined;
  const end    = url.searchParams.get("end")    || undefined;
  const tz     = url.searchParams.get("tz")     || "UTC";

  try {
    const result = queryTimeseries({ metric, bucket, range, start, end, tz });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
};
