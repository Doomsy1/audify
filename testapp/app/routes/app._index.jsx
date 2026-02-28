import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { VoiceAnalyticsScreen } from "../components/voice/VoiceAnalyticsScreen.jsx";
import { buildVoiceDirectUrl } from "../lib/voice/directAccess.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  return {
    standaloneUrl: buildVoiceDirectUrl({
      requestUrl: request.url,
      shop: session?.shop,
    }),
  };
};

export default function UnifiedAssistantRoute() {
  const { standaloneUrl } = useLoaderData();

  return (
    <s-page heading="Analytics Assistant">
      <s-section>
        <VoiceAnalyticsScreen standaloneUrl={standaloneUrl} />
      </s-section>
    </s-page>
  );
}
