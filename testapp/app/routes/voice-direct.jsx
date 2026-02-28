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
      <div
        style={{
          maxWidth: 860,
          margin: "0 auto",
          background: "#fff",
          border: "1px solid #dde5ea",
          borderRadius: 16,
          padding: 24,
          boxShadow: "0 16px 40px rgba(15, 23, 42, 0.08)",
        }}
      >
        <div style={{ display: "grid", gap: 6, marginBottom: 18 }}>
          <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2 }}>Voice Analytics</h1>
          <p style={{ margin: 0, color: "#52636f", fontSize: 14 }}>
            Standalone voice mode on the app origin. This route avoids the embedded Shopify iframe.
          </p>
          <p style={{ margin: 0, color: "#52636f", fontSize: 12 }}>
            {currentUrl}
          </p>
        </div>

        {accessGranted ? (
          <VoiceAnalyticsScreen
            standaloneUrl={currentUrl}
            hideStandaloneCta
            directAccessToken={directAccessToken}
          />
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
            Standalone voice access expired or is missing. Reopen this page from the embedded Voice Analytics route.
          </div>
        )}
      </div>
    </main>
  );
}
