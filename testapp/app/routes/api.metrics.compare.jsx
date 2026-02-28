import { authenticate }  from "../shopify.server";
import { queryCompare }  from "../lib/metrics/query.server.js";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const url   = new URL(request.url);
  const range = url.searchParams.get("range") || "last_7d";
  const start = url.searchParams.get("start") || undefined;
  const end   = url.searchParams.get("end")   || undefined;
  const tz    = url.searchParams.get("tz")    || "UTC";

  try {
    const result = queryCompare({ range, start, end, tz });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
};
