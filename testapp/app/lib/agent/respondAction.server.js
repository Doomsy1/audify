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

function extractVoiceDirectToken(request) {
  const url = new URL(request.url);
  const headerToken = request?.headers?.get?.("x-voice-direct-token");
  if (headerToken) {
    return headerToken;
  }

  const authorization = request?.headers?.get?.("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  return url.searchParams.get("voice_token") || "";
}

export function createAgentRespondAction({
  authenticateAdmin,
  respond,
  verifyDirectAccess = null,
}) {
  return async ({ request }) => {
    let payload;
    try {
      payload = await request.json();
    } catch (_) {
      return badRequest("Invalid JSON body");
    }

    try {
      let directAccess = null;
      if (verifyDirectAccess) {
        const directAccessToken = extractVoiceDirectToken(request);
        if (directAccessToken) {
          directAccess = await verifyDirectAccess(directAccessToken);
        }
      }

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
