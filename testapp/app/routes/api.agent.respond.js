import { authenticate } from "../shopify.server.js";
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

export function createAgentRespondAction({
  authenticateAdmin,
  respond,
}) {
  return async ({ request }) => {
    let payload;
    try {
      payload = await request.json();
    } catch (_) {
      return badRequest("Invalid JSON body");
    }

    try {
      const directAccess = verifyVoiceDirectToken(extractVoiceDirectToken(request));
      let shop = directAccess?.shop;
      let accessToken;

      if (!shop) {
        const { session } = await authenticateAdmin(request);
        shop = session?.shop;
        accessToken = session?.accessToken;
      }

      const response = await respond({
        payload,
        shop,
        accessToken,
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
}

export const action = createAgentRespondAction({
  authenticateAdmin: authenticate.admin,
  respond: async (input) => {
    const { respondToAgentRequest } = await import("../lib/agent/orchestrator.server.js");
    return respondToAgentRequest(input);
  },
});
