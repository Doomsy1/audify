import { authenticate }      from "../shopify.server";
import { renderCompareClip } from "../lib/sonification/renderSeries.server.js";

export const action = async ({ request }) => {
  await authenticate.admin(request);

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { a, b, mapping, render } = body ?? {};

  if (!Array.isArray(a?.points) || !a.points.length) {
    return Response.json({ error: "a.points must be a non-empty array" }, { status: 400 });
  }
  if (!Array.isArray(b?.points) || !b.points.length) {
    return Response.json({ error: "b.points must be a non-empty array" }, { status: 400 });
  }
  if (!a.label || !b.label) {
    return Response.json({ error: "a.label and b.label are required" }, { status: 400 });
  }

  try {
    const result = renderCompareClip({ a, b, mapping, render });
    return Response.json(result, { status: 200 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
};
