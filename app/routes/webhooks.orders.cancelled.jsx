import { authenticate } from "../shopify.server";
import { reversePointsForCancelledOrder } from "../services/orders.server";

// 这个文件对应 /webhooks/orders/cancelled 路由。
// Shopify 的 orders/cancelled webhook 打到这个地址时，会把已发订单积分冲回。
export const action = async ({ request }) => {
  // 这个 header 只用于日志排查；真正防重复扣积分还是用订单 id。
  // 同一笔订单取消重试时，webhook id 可能不同，但订单 id 不变，所以不能用 webhook id 当业务唯一键。
  const webhookId = request.headers.get("x-shopify-webhook-id");

  // authenticate.webhook 会校验 Shopify 签名，避免别人伪造 webhook 请求。
  // payload 是 Shopify 发来的订单数据；shop 是店铺域名；topic 正常会是 orders/cancelled。
  const { payload, shop, topic } = await authenticate.webhook(request);

  // 取消订单后不删除原积分流水，而是新增一条负数流水，方便以后对账。
  // 具体的查原流水、扣余额、更新等级、写 CANCEL 流水，都放在 service 函数里。
  const result = await reversePointsForCancelledOrder({
    shop,
    topic,
    webhookId,
    order: payload,
  });

  console.log(
    `Processed ${topic} webhook for ${shop}: ${result.status} (${result.resourceId})`,
  );

  // 返回 200 表示这个 webhook 请求已经被 App 接收。
  // 如果这里抛错，Shopify 之后可能会重试发送同一个 webhook。
  return new Response();
};
