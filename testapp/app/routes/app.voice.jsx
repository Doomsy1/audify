import { authenticate } from "../shopify.server";
import { useLoaderData } from "react-router";
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

export default function VoiceAnalyticsRoute() {
  const { standaloneUrl } = useLoaderData();

  return (
    <s-page heading="Voice Analytics">
      <s-section>
        <VoiceAnalyticsScreen standaloneUrl={standaloneUrl} />
      </s-section>
    </s-page>
  );
}
