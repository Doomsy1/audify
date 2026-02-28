import { authenticate } from "../shopify.server";
import { respondToAgentRequest } from "../lib/agent/orchestrator.server";
import {
  extractVoiceDirectToken,
  verifyVoiceDirectToken,
} from "../lib/voice/directAccess.server.js";

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
  let payload;
  try {
    payload = await request.json();
  } catch (_) {
    return badRequest("Invalid JSON body");
  }

  try {
    const directAccess = verifyVoiceDirectToken(extractVoiceDirectToken(request));
    let shop = directAccess?.shop;

    if (!shop) {
      const { session } = await authenticate.admin(request);
      shop = session?.shop;
    }

    const response = await respondToAgentRequest({
      payload,
      shop,
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
