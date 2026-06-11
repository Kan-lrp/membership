import { authenticate } from "../shopify.server";
import { reversePointsForRefundedOrder } from "../services/orders.server";

// 这个文件对应 /webhooks/refunds/create 路由。
// Shopify 的有效退款 topic 是 refunds/create，不是 orders/refunded。
export const action = async ({ request }) => {
  // webhook id 只用于排查日志；真正的业务幂等键是 orderId + refundId。
  const webhookId = request.headers.get("x-shopify-webhook-id");

  // payload 是 Shopify 发来的 Refund 数据，里面通常会带 order_id。
  // 注意这里不是订单完整数据，所以 service 里会先用 order_id 找原订单积分流水。
  const { payload, shop, topic } = await authenticate.webhook(request);

  // 退款扣分逻辑放在 service 层：
  // 1. 找原订单 EARN 流水
  // 2. 按退款金额算要扣多少积分
  // 3. 写 REFUND 负数流水
  // 4. 更新余额和等级
  const result = await reversePointsForRefundedOrder({
    shop,
    topic,
    webhookId,
    order: payload,
  });

  console.log(
    `Processed ${topic} webhook for ${shop}: ${result.status} (${result.resourceId})`,
  );

  return new Response();
};
