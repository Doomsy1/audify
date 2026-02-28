import { authenticate } from "../shopify.server.js";
import { createAgentRespondAction } from "../lib/agent/respondAction.server.js";

export const action = createAgentRespondAction({
  authenticateAdmin: authenticate.admin,
  verifyDirectAccess: async (token) => {
    const { verifyVoiceDirectToken } = await import("../lib/voice/directAccess.server.js");
    return verifyVoiceDirectToken(token);
  },
  respond: async (input) => {
    const { respondToAgentRequest } = await import("../lib/agent/orchestrator.server.js");
    return respondToAgentRequest(input);
  },
});
