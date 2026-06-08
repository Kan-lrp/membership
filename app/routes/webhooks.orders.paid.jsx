import { authenticate } from "../shopify.server";
import { awardPointsForPaidOrder } from "../models/points.server";

// 这个文件对应 /webhooks/orders/paid 路由。
// Shopify 的 orders/paid webhook 打到这个地址时，React Router 会调用 action。
export const action = async ({ request }) => {
  // Shopify 每次 webhook 请求都会带 x-shopify-webhook-id。
  // 它适合做日志排查，但不适合作为“发积分”的业务幂等键。
  // 我们真正防重复发积分用的是订单 id，也就是 service 里的 resourceId。
  const webhookId = request.headers.get("x-shopify-webhook-id");

  // authenticate.webhook 会校验 Shopify 签名，并解析出店铺、topic 和 payload。
  // payload 就是订单数据，shop 是店铺域名，topic 是 orders/paid。
  const { payload, shop, topic } = await authenticate.webhook(request);

  // 真正的积分发放逻辑放到 service 里，路由只负责接收 webhook 和返回 200。
  const result = await awardPointsForPaidOrder({
    shop,
    topic,
    webhookId,
    order: payload,
  });

  console.log(
    `Processed ${topic} webhook for ${shop}: ${result.status} (${result.resourceId})`,
  );

  // Shopify webhook 只关心我们是否成功接收并处理。
  // 返回 200 空响应即可；具体处理结果已经写入数据库和日志。
  return new Response();
};
