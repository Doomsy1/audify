import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";

export function createAuthCatchallLoader({ authenticateAdmin }) {
  return async ({ request }) => {
    await authenticateAdmin(request);

    return null;
  };
}

export const loader = createAuthCatchallLoader({
  authenticateAdmin: authenticate.admin,
});

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
