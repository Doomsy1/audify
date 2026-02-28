import { authenticate } from "../shopify.server.js";
import db from "../db.server.js";

export function createWebhookUninstalledAction({
  authenticateWebhook,
  deleteSessionsByShop,
}) {
  return async ({ request }) => {
    const { shop, session, topic } = await authenticateWebhook(request);

    console.log(`Received ${topic} webhook for ${shop}`);

    // Webhook requests can trigger multiple times and after an app has already been uninstalled.
    // If this webhook already ran, the session may have been deleted previously.
    if (session) {
      await deleteSessionsByShop({ where: { shop } });
    }

    return new Response();
  };
}

export const action = createWebhookUninstalledAction({
  authenticateWebhook: authenticate.webhook,
  deleteSessionsByShop: db.session.deleteMany.bind(db.session),
});
