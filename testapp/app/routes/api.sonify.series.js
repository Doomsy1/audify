import { authenticate }      from "../shopify.server.js";
import { renderSeriesClip }  from "../lib/sonification/renderSeries.server.js";

export function createSonifySeriesAction({ authenticateAdmin, renderSeries }) {
  return async ({ request }) => {
    await authenticateAdmin(request);

    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { series, mapping, render } = body ?? {};

    if (!Array.isArray(series?.points) || series.points.length === 0) {
      return Response.json(
        { error: "series.points must be a non-empty array of { t, v } objects" },
        { status: 400 },
      );
    }

    // Validate each point has a numeric v
    for (const pt of series.points) {
      if (typeof pt?.v !== "number" || !isFinite(pt.v)) {
        return Response.json(
          { error: "Each series point must have a finite numeric v field" },
          { status: 400 },
        );
      }
    }

    try {
      const result = renderSeries({ series, mapping, render });
      return Response.json(result, { status: 200 });
    } catch (err) {
      return Response.json({ error: err.message }, { status: 500 });
    }
  };
}

export const action = createSonifySeriesAction({
  authenticateAdmin: authenticate.admin,
  renderSeries: renderSeriesClip,
});
