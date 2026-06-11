import db from "../db.server";
import {
  getDisplayLevel,
  getOrCreateDefaultLevelConfigs,
} from "./levels.server";
import { formatMemberName, serializeLedger } from "./shared.server";

// 这个文件负责“webhook 日志和异常看板”。
// 主要负责：
// 1. 日志页读取所有 webhook 处理记录
// 2. 异常处理页读取 FAILED / SKIPPED webhook
// 3. 异常处理页读取负积分会员
// 注意：这里不处理 webhook 业务本身，只读取处理结果。
// 真正的订单付款/取消/退款处理在 orders.server.js。

function serializeWebhookEvent(event) {
  // 日志页只需要展示处理状态、topic、订单号、错误原因和时间。
  // resourceId 仍然返回给前端备用，但默认页面不展示它，因为它是 Shopify gid，不适合商家阅读。
  // resourceName 是给商家看的订单号，例如 #1001；历史旧日志没有这个字段时会是 null。
  return {
    id: event.id,
    shop: event.shop,
    topic: event.topic,
    resourceId: event.resourceId,
    resourceName: event.resourceName,
    status: event.status,
    attempts: event.attempts,
    error: event.error,
    receivedAt: event.receivedAt.toISOString(),
    processedAt: event.processedAt?.toISOString() ?? null,
  };
}

export async function getWebhookLogsData(shop) {
  // 日志页读取最近的 webhook 事件。
  // 当订单没有加分、取消没有扣分时，优先看这里的 status 和 error。
  const events = await db.webhookEvent.findMany({
    where: { shop },
    orderBy: { receivedAt: "desc" },
    take: 100,
  });

  return {
    events: events.map(serializeWebhookEvent),
  };
}

export async function getExceptionData(shop) {
  // 异常处理页把“需要人工关注”的数据集中展示。
  // MVP 先关注两类：
  // 1. 负积分会员：通常是积分被用掉后又发生取消/退款。
  // 2. webhook 异常：FAILED 或 SKIPPED 的事件。
  const levels = await getOrCreateDefaultLevelConfigs(shop);
  const [negativeAccounts, webhookIssues] = await Promise.all([
    db.pointsAccount.findMany({
      where: {
        shop,
        balance: {
          lt: 0,
        },
      },
      include: {
        member: {
          include: {
            currentLevel: true,
          },
        },
        ledgers: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { balance: "asc" },
      take: 50,
    }),
    db.webhookEvent.findMany({
      where: {
        shop,
        status: {
          in: ["FAILED", "SKIPPED"],
        },
      },
      orderBy: { receivedAt: "desc" },
      take: 100,
    }),
  ]);

  return {
    negativeMembers: negativeAccounts.map((account) => {
      const latestLedger = account.ledgers[0];
      const level = getDisplayLevel(
        account.member,
        levels,
        account.lifetimeEarned,
      );
      const serializedLedger = latestLedger
        ? serializeLedger(latestLedger)
        : null;

      return {
        id: account.member.id,
        name: formatMemberName(account.member),
        email: account.member.email,
        levelName: level?.name ?? "无等级",
        balance: account.balance,
        lifetimeEarned: account.lifetimeEarned,
        latestLedger: serializedLedger
          ? {
              type: serializedLedger.type,
              points: serializedLedger.points,
              reason: serializedLedger.reason,
              createdAt: serializedLedger.createdAt,
            }
          : null,
      };
    }),
    webhookIssues: webhookIssues.map(serializeWebhookEvent),
  };
}
