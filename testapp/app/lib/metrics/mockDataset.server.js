/**
 * Deterministic mock analytics dataset — 30 days of order history.
 *
 * Structure:
 *  - ~8 orders/day baseline, realistic daily variation
 *  - One clear spike: days 9–10 (email campaign, 3× baseline)
 *  - One clear dip:  day 22 (fulfilment outage, 0.3× baseline)
 *  - Three products with different price points
 *  - Weekend uplift (~1.3×)
 *
 * All data is computed once and cached for the process lifetime.
 */

export const PRODUCTS = [
  { id: "prod_headphones", title: "Wireless Headphones", price: 89.0 },
  { id: "prod_case",       title: "Phone Case",          price: 19.0 },
  { id: "prod_stand",      title: "Laptop Stand",        price: 45.0 },
];

/** Seeded PRNG — same output every run. */
function mulberry32(seed) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build 30 days of mock orders.
 * day=0 → 30 days ago (oldest), day=29 → yesterday (most recent).
 *
 * @returns {Array<{
 *   id: string,
 *   createdAt: string,
 *   totalPrice: number,
 *   lineItems: Array<{productId:string, title:string, price:number, quantity:number}>
 * }>}
 */
function generateOrders() {
  const rand = mulberry32(0xdeadbeef);
  const orders = [];

  // Anchor to a fixed reference so the dataset is stable regardless of runtime.
  // "today" = the process start date, but day indices are relative so results
  // are always internally consistent.
  const now = new Date();
  now.setHours(23, 59, 59, 999);

  for (let day = 29; day >= 0; day--) {
    const date = new Date(now);
    date.setDate(date.getDate() - day);

    // Base order count
    let count = 5 + Math.floor(rand() * 5); // 5–9

    // Spike: days 9–10 from end (i.e. about 10–11 days ago) → email campaign
    if (day === 10 || day === 9) count = Math.round(count * 3.2);

    // Dip: day 7 from end (~1 week ago) → fulfilment outage
    if (day === 7) count = Math.max(1, Math.round(count * 0.3));

    // Weekend uplift
    const dow = date.getDay(); // 0=Sun, 6=Sat
    if (dow === 0 || dow === 6) count = Math.round(count * 1.35);

    for (let o = 0; o < count; o++) {
      const product = PRODUCTS[Math.floor(rand() * PRODUCTS.length)];
      const quantity = rand() < 0.85 ? 1 : 2;
      const orderDate = new Date(date);
      orderDate.setHours(
        Math.floor(rand() * 24),
        Math.floor(rand() * 60),
        Math.floor(rand() * 60),
        0,
      );

      orders.push({
        id: `mock_${day}_${o}`,
        createdAt: orderDate.toISOString(),
        totalPrice: Math.round(product.price * quantity * 100) / 100,
        lineItems: [
          {
            productId: product.id,
            title: product.title,
            price: product.price,
            quantity,
          },
        ],
      });
    }
  }

  return orders;
}

// Module-level cache — generated once per server process.
let _orders = null;

/** @returns {ReturnType<typeof generateOrders>} */
export function getMockOrders() {
  if (!_orders) _orders = generateOrders();
  return _orders;
}
