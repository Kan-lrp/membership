import db from "../db.server";
import {
  ORDER_PAID_SOURCE_TYPE,
  ORDER_REFUNDED_SOURCE_TYPE,
} from "./constants.server";

// 这个文件放“多个 service 都会用到的服务端工具”。
// 主要负责：
// 1. 格式化会员名称
// 2. 格式化积分流水给页面使用
// 3. 从旧退款流水里补订单号
// 4. 格式化时间线事件
// 注意：这里不是前端组件，也不应该直接处理业务流程。

export function formatMemberName(member) {
  // 后台列表优先显示顾客姓名；没有姓名时显示邮箱；再没有就显示 customerId。
  const name = [member.firstName, member.lastName].filter(Boolean).join(" ");
  return name || member.email || member.customerId;
}

export function serializeTimelineEvent(event) {
  return {
    id: event.id,
    type: event.type,
    title: event.title,
    content: event.content,
    actorName: event.actorName,
    actorEmail: event.actorEmail,
    createdAt: event.createdAt.toISOString(),
  };
}

export function getOrderResourceIdFromRefundSourceId(sourceId) {
  // REFUND sourceId 是 orderId + refundId 拼出来的。
  // 常见格式：
  // gid://shopify/Order/1:gid://shopify/Refund/2
  // gid://shopify/Order/1:2
  // 这里把前面的订单 gid 提取出来，用来找原 ORDER_PAID 流水。
  const refundGidSeparator = ":gid://shopify/Refund/";

  if (sourceId.includes(refundGidSeparator)) {
    return sourceId.split(refundGidSeparator)[0];
  }

  const lastSeparatorIndex = sourceId.lastIndexOf(":");

  if (lastSeparatorIndex > "gid://".length) {
    return sourceId.slice(0, lastSeparatorIndex);
  }

  return sourceId;
}

export function serializeLedger(ledger) {
  // 把积分流水转换成前端表格需要的格式。
  // 这里顺手把 Date 转成字符串，因为浏览器端更容易处理字符串。
  let metadata = null;

  try {
    metadata = ledger.metadataJson ? JSON.parse(ledger.metadataJson) : null;
  } catch {
    metadata = null;
  }

  return {
    id: ledger.id,
    memberId: ledger.memberId,
    customerName: ledger.member ? formatMemberName(ledger.member) : null,
    customerEmail: ledger.member?.email ?? null,
    orderName: metadata?.orderName ?? null,
    orderId:
      ledger.sourceType === ORDER_REFUNDED_SOURCE_TYPE
        ? getOrderResourceIdFromRefundSourceId(ledger.sourceId)
        : ledger.sourceId?.startsWith("gid://shopify/Order/")
          ? ledger.sourceId
          : null,
    type: ledger.type,
    points: ledger.points,
    balanceAfter: ledger.balanceAfter,
    reason: ledger.reason,
    sourceId: ledger.sourceId,
    sourceType: ledger.sourceType,
    createdAt: ledger.createdAt.toISOString(),
  };
}

export async function hydrateLedgerOrderNames(shop, ledgers) {
  // 旧的 REFUND 流水可能没有保存 orderName。
  // REFUND 的 sourceId 形如 orderId:refundId，所以可以用 orderId 找回原 ORDER_PAID 流水里的 orderName。
  const missingRefundOrderIds = [
    ...new Set(
      ledgers
        .filter((ledger) => {
          const serialized = serializeLedger(ledger);
          return (
            !serialized.orderName &&
            ledger.sourceType === ORDER_REFUNDED_SOURCE_TYPE &&
            ledger.sourceId.includes(":")
          );
        })
        .map((ledger) => getOrderResourceIdFromRefundSourceId(ledger.sourceId)),
    ),
  ];

  if (missingRefundOrderIds.length === 0) {
    return ledgers.map(serializeLedger);
  }

  const paidLedgers = await db.pointsLedger.findMany({
    where: {
      shop,
      sourceType: ORDER_PAID_SOURCE_TYPE,
      sourceId: {
        in: missingRefundOrderIds,
      },
    },
  });
  const orderNameByOrderId = new Map(
    paidLedgers.map((ledger) => {
      const serialized = serializeLedger(ledger);
      return [ledger.sourceId, serialized.orderName];
    }),
  );

  return ledgers.map((ledger) => {
    const serialized = serializeLedger(ledger);

    if (serialized.orderName || ledger.sourceType !== ORDER_REFUNDED_SOURCE_TYPE) {
      return serialized;
    }

    const orderId = getOrderResourceIdFromRefundSourceId(ledger.sourceId);

    return {
      ...serialized,
      orderName: orderNameByOrderId.get(orderId) ?? null,
    };
  });
}
