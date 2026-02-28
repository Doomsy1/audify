import { authenticate }    from "../shopify.server";
import { detectAnomalies } from "../lib/metrics/anomalies.server.js";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const url         = new URL(request.url);
  const metric      = url.searchParams.get("metric")      || "revenue";
  const range       = url.searchParams.get("range")       || "last_30d";
  const start       = url.searchParams.get("start")       || undefined;
  const end         = url.searchParams.get("end")         || undefined;
  const tz          = url.searchParams.get("tz")          || "UTC";
  const windowDays  = Number(url.searchParams.get("window") || 7);
  const zThreshold  = Number(url.searchParams.get("z")      || 2.0);

  try {
    const result = detectAnomalies({ metric, range, start, end, tz, windowDays, zThreshold });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
};
