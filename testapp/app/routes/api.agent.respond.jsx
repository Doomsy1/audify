import { authenticate } from "../shopify.server";
import { respondToAgentRequest } from "../lib/agent/orchestrator.server";

function badRequest(message, status = 400) {
  return Response.json(
    {
      ok: false,
      error: message,
      code: "AGENT_BAD_REQUEST",
    },
    { status },
  );
}

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  let payload;
  try {
    payload = await request.json();
  } catch (_) {
    return badRequest("Invalid JSON body");
  }

  try {
    const response = await respondToAgentRequest({
      payload,
      shop: session?.shop,
    });

    return Response.json(response);
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to complete agent response",
        code: "AGENT_TOOL_FAILURE",
      },
      { status: 502 },
    );
  }
};