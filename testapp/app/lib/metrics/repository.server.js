/**
 * Data-access layer — thin wrapper over the mock dataset.
 * Swap this out to query Prisma / Shopify Admin API in production.
 */

import { getMockOrders } from "./mockDataset.server.js";

/**
 * Return all mock orders whose `createdAt` falls within [startDate, endDate].
 *
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {ReturnType<typeof getMockOrders>}
 */
export function getOrdersInRange(startDate, endDate) {
  return getMockOrders().filter((order) => {
    const d = new Date(order.createdAt);
    return d >= startDate && d <= endDate;
  });
}
