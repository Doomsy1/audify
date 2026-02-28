import { useLoaderData } from "react-router";
import { VoiceAnalyticsScreen } from "../components/voice/VoiceAnalyticsScreen.jsx";
import {
  extractVoiceDirectToken,
  verifyVoiceDirectToken,
} from "../lib/voice/directAccess.server.js";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const directAccessToken = extractVoiceDirectToken(request);
  const access = verifyVoiceDirectToken(directAccessToken);

  return {
    directAccessToken: access ? directAccessToken : "",
    accessGranted: Boolean(access),
    currentUrl: `${url.origin}${url.pathname}`,
  };
};

export default function VoiceDirectRoute() {
  const { currentUrl, directAccessToken, accessGranted } = useLoaderData();

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
          <div
            style={{
              display: "grid",
              gap: 16,
            }}
          >
            <div
              style={{
                borderRadius: 12,
                border: "1px solid #dfe3e8",
                background: "#fff",
                padding: 14,
              }}
            >
              <div style={{ display: "grid", gap: 6 }}>
                <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2 }}>Analytics Assistant</h1>
                <p style={{ margin: 0, color: "#52606d", fontSize: 14 }}>
                  Standalone voice mode on the app domain.
                </p>
                <p style={{ margin: 0, color: "#52606d", fontSize: 12 }}>{currentUrl}</p>
              </div>
            </div>

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
