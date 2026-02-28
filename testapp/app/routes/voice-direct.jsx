import { useLoaderData } from "react-router";
import { VoiceAnalyticsScreen } from "../components/voice/VoiceAnalyticsScreen.jsx";
import {
  extractVoiceDirectToken,
  verifyVoiceDirectToken,
} from "../lib/voice/directAccess.server.js";

export const loader = async ({ request }) => {
  const directAccessToken = extractVoiceDirectToken(request);
  const access = verifyVoiceDirectToken(directAccessToken);

  return {
    directAccessToken: access ? directAccessToken : "",
    accessGranted: Boolean(access),
  };
};

export default function VoiceDirectRoute() {
  const { directAccessToken, accessGranted } = useLoaderData();

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f1f3f5",
        padding: "32px 20px",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: 1040, margin: "0 auto" }}>
        {accessGranted ? (
          <div style={{ display: "grid", justifyContent: "start" }}>
            <VoiceAnalyticsScreen
              hideStandaloneCta
              directAccessToken={directAccessToken}
            />
          </div>
        ) : (
          <div
            style={{
              borderRadius: 12,
              border: "1px solid #f3c7c7",
              background: "#fff5f5",
              color: "#9f1c1c",
              padding: 16,
            }}
          >
            Standalone voice access expired or is missing. Reopen this page from the embedded Analytics Assistant route.
          </div>
        )}
      </div>
    </main>
  );
}
