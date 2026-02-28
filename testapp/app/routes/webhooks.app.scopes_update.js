import { authenticate } from "../shopify.server.js";
import db from "../db.server.js";

export function createWebhookScopesUpdateAction({
  authenticateWebhook,
  updateSessionScope,
}) {
  return async ({ request }) => {
    const { payload, session, topic, shop } = await authenticateWebhook(request);

    console.log(`Received ${topic} webhook for ${shop}`);
    const current = payload.current;

    if (session) {
      await updateSessionScope({
        where: {
          id: session.id,
        },
        data: {
          scope: current.toString(),
        },
      });
    }

    return new Response();
  };
}

export const action = createWebhookScopesUpdateAction({
  authenticateWebhook: authenticate.webhook,
  updateSessionScope: db.session.update.bind(db.session),
});
