import db from "../db.server.js";
import {
  MEMBER_STATUS,
  ORDER_CANCELLED_SOURCE_TYPE,
  ORDER_PAID_SOURCE_TYPE,
  ORDER_REFUNDED_SOURCE_TYPE,
} from "./constants.server.js";
import {
  getMoneySetAmount,
  parseMoneyToCents,
} from "../utils/money.server.js";
import {
  getLevelForPoints,
  getOrCreateDefaultLevelConfigs,
} from "./levels.server.js";
import { getOrCreateRuleConfig } from "./dashboard.server.js";

// 这个文件负责“Shopify 订单事件对积分的影响”。
// 主要负责：
// 1. orders/paid：订单付款后给已开通会员发积分
// 2. orders/cancelled：订单取消后扣回已发积分
// 3. refunds/create：订单退款后按退款金额扣回部分积分
// 4. 处理 Shopify order/refund payload 里的金额、订单 id、退款 id
// 5. 写 webhook 处理状态，避免 webhook 重试导致重复入账
// 注意：商家手动加扣积分不在这里，放 points.server.js。
// 注意：这里只是后端业务逻辑，不是页面组件。

function getOrderResourceId(order) {
  const resourceId = order?.admin_graphql_api_id || order?.id;

  if (!resourceId) {
    throw new Error("Order webhook payload is missing an order id.");
  }

  return String(resourceId);
}

function getOrderResourceName(order) {
  return order?.name || order?.order_number || order?.orderNumber || null;
}

function getRefundOrderResourceId(payload) {
  const orderId =
    payload?.order?.admin_graphql_api_id ||
    payload?.order_admin_graphql_api_id ||
    payload?.order?.id ||
    payload?.order_id;

  if (!orderId) {
    throw new Error("Refund webhook payload is missing an order id.");
  }

  const normalizedOrderId = String(orderId);

  if (normalizedOrderId.startsWith("gid://shopify/Order/")) {
    return normalizedOrderId;
  }

  return `gid://shopify/Order/${normalizedOrderId}`;
}

function getRefundResourceName(refund, earnedLedger) {
  let metadata = null;

  try {
    metadata = earnedLedger?.metadataJson
      ? JSON.parse(earnedLedger.metadataJson)
      : null;
  } catch {
    metadata = null;
  }

  return (
    refund?.order?.name ||
    refund?.order_name ||
    refund?.name ||
    metadata?.orderName ||
    null
  );
}

function getCustomerId(customer) {
  const customerId = customer?.admin_graphql_api_id || customer?.id;
  return customerId ? String(customerId) : null;
}

function getOrderTotalCents(order) {
  return parseMoneyToCents(order?.current_total_price ?? order?.total_price);
}

function getRefundResourceId(orderResourceId, refund, refundCents) {
  const refundId =
    refund?.admin_graphql_api_id ||
    refund?.id ||
    refund?.created_at ||
    refund?.processed_at ||
    refund?.createdAt ||
    refund?.processedAt ||
    refundCents;

  return `${orderResourceId}:${refundId}`;
}

function getRefundEntries(order) {
  if (Array.isArray(order?.refunds) && order.refunds.length > 0) {
    return order.refunds;
  }

  if (order?.refund_line_items || order?.transactions || order?.order_adjustments) {
    return [order];
  }

  return [];
}

function getRefundAmountCents(refund) {
  const transactionCents = (refund?.transactions ?? []).reduce((sum, transaction) => {
    const kind = String(transaction.kind ?? "").toLowerCase();
    const status = String(transaction.status ?? "").toLowerCase();
    const isRefund = !kind || kind === "refund";
    const isSuccessful = !status || status === "success";

    if (!isRefund || !isSuccessful) {
      return sum;
    }

    return sum + parseMoneyToCents(getMoneySetAmount(transaction.amount_set) ?? transaction.amount);
  }, 0);

  if (transactionCents > 0) {
    return transactionCents;
  }

  const directAmount =
    refund?.amount ??
    refund?.total_refunded ??
    refund?.totalRefunded ??
    refund?.subtotal ??
    refund?.total;
  const directCents = parseMoneyToCents(getMoneySetAmount(directAmount));

  if (directCents > 0) {
    return directCents;
  }

  const lineItemCents = (refund?.refund_line_items ?? []).reduce((sum, item) => {
    const subtotal = parseMoneyToCents(
      getMoneySetAmount(item.subtotal_set) ?? item.subtotal,
    );
    const tax = parseMoneyToCents(
      getMoneySetAmount(item.total_tax_set) ?? item.total_tax,
    );

    return sum + subtotal + tax;
  }, 0);

  const adjustmentCents = (refund?.order_adjustments ?? []).reduce((sum, adjustment) => {
    const amount = parseMoneyToCents(
      getMoneySetAmount(adjustment.amount_set) ?? adjustment.amount,
    );
    const tax = parseMoneyToCents(
      getMoneySetAmount(adjustment.tax_amount_set) ?? adjustment.tax_amount,
    );

    return sum + amount + tax;
  }, 0);

  return lineItemCents + adjustmentCents;
}

export function calculateEarnedPoints(totalCents, rule) {
  if (!rule.isEnabled || totalCents <= 0 || rule.currencyUnitCents <= 0) {
    return 0;
  }

  return Math.floor(
    (totalCents * rule.pointsPerCurrencyUnit) / rule.currencyUnitCents,
  );
}

export async function awardPointsForPaidOrder({
  shop,
  topic,
  webhookId,
  order,
}) {
  const resourceId = getOrderResourceId(order);
  const resourceName = getOrderResourceName(order);

  try {
    return await db.$transaction(async (tx) => {
      const existingEvent = await tx.webhookEvent.findUnique({
        where: {
          shop_topic_resourceId: {
            shop,
            topic,
            resourceId,
          },
        },
      });

      if (
        existingEvent?.status === "PROCESSED" ||
        existingEvent?.status === "SKIPPED"
      ) {
        return { status: "duplicate", resourceId };
      }

      await tx.webhookEvent.upsert({
        where: {
          shop_topic_resourceId: {
            shop,
            topic,
            resourceId,
          },
        },
        update: {
          resourceName,
          status: "PROCESSING",
          attempts: { increment: 1 },
          error: null,
        },
        create: {
          shop,
          topic,
          resourceId,
          resourceName,
          shopifyWebhookId: webhookId,
          status: "PROCESSING",
          attempts: 1,
        },
      });

      const customer = order.customer;
      const customerId = getCustomerId(customer);

      if (!customerId) {
        await tx.webhookEvent.update({
          where: {
            shop_topic_resourceId: {
              shop,
              topic,
              resourceId,
            },
          },
          data: {
            resourceName,
            status: "SKIPPED",
            error: "Order has no customer.",
            processedAt: new Date(),
          },
        });

        return { status: "skipped", resourceId, reason: "missing_customer" };
      }

      const member = await tx.member.upsert({
        where: {
          shop_customerId: {
            shop,
            customerId,
          },
        },
        update: {
          email: customer.email ?? order.email ?? null,
          firstName: customer.first_name ?? null,
          lastName: customer.last_name ?? null,
        },
        create: {
          shop,
          customerId,
          email: customer.email ?? order.email ?? null,
          firstName: customer.first_name ?? null,
          lastName: customer.last_name ?? null,
          status: MEMBER_STATUS.PENDING,
        },
      });

      if (member.status !== MEMBER_STATUS.ACTIVE) {
        await tx.webhookEvent.update({
          where: {
            shop_topic_resourceId: {
              shop,
              topic,
              resourceId,
            },
          },
          data: {
            resourceName,
            status: "SKIPPED",
            error: `Member status is ${member.status}.`,
            processedAt: new Date(),
          },
        });

        return { status: "skipped", resourceId, reason: "member_not_active" };
      }

      const rule = await getOrCreateRuleConfig(shop, tx);
      const totalCents = getOrderTotalCents(order);
      const points = calculateEarnedPoints(totalCents, rule);

      if (points <= 0) {
        await tx.webhookEvent.update({
          where: {
            shop_topic_resourceId: {
              shop,
              topic,
              resourceId,
            },
          },
          data: {
            resourceName,
            status: "SKIPPED",
            error: rule.isEnabled
              ? "Order total produced zero points."
              : "Points rule is disabled.",
            processedAt: new Date(),
          },
        });

        return { status: "skipped", resourceId, reason: "zero_points" };
      }

      const account = await tx.pointsAccount.upsert({
        where: {
          shop_memberId: {
            shop,
            memberId: member.id,
          },
        },
        update: {},
        create: {
          shop,
          memberId: member.id,
        },
      });

      const existingLedger = await tx.pointsLedger.findUnique({
        where: {
          shop_sourceType_sourceId: {
            shop,
            sourceType: ORDER_PAID_SOURCE_TYPE,
            sourceId: resourceId,
          },
        },
      });

      if (existingLedger) {
        await tx.webhookEvent.update({
          where: {
            shop_topic_resourceId: {
              shop,
              topic,
              resourceId,
            },
          },
          data: {
            resourceName,
            status: "PROCESSED",
            processedAt: new Date(),
          },
        });

        return { status: "duplicate", resourceId };
      }

      const updatedAccount = await tx.pointsAccount.update({
        where: { id: account.id },
        data: {
          balance: { increment: points },
          lifetimeEarned: { increment: points },
        },
      });

      const levels = await getOrCreateDefaultLevelConfigs(shop, tx);
      const currentLevel = getLevelForPoints(levels, updatedAccount.lifetimeEarned);

      if (currentLevel && member.currentLevelId !== currentLevel.id) {
        await tx.member.update({
          where: { id: member.id },
          data: {
            currentLevelId: currentLevel.id,
          },
        });
      }

      const ledger = await tx.pointsLedger.create({
        data: {
          shop,
          memberId: member.id,
          accountId: account.id,
          type: "EARN",
          points,
          balanceAfter: updatedAccount.balance,
          reason: "Order paid",
          sourceType: ORDER_PAID_SOURCE_TYPE,
          sourceId: resourceId,
          metadataJson: JSON.stringify({
            orderName: order.name,
            totalPrice: order.current_total_price ?? order.total_price,
            customerId,
          }),
        },
      });

      await tx.webhookEvent.update({
        where: {
          shop_topic_resourceId: {
            shop,
            topic,
            resourceId,
          },
        },
        data: {
          resourceName,
          status: "PROCESSED",
          processedAt: new Date(),
        },
      });

      return {
        status: "processed",
        resourceId,
        points,
        ledgerId: ledger.id,
      };
    });
  } catch (error) {
    await db.webhookEvent.upsert({
      where: {
        shop_topic_resourceId: {
          shop,
          topic,
          resourceId,
        },
      },
      update: {
        resourceName,
        status: "FAILED",
        attempts: { increment: 1 },
        error: error.message,
      },
      create: {
        shop,
        topic,
        resourceId,
        resourceName,
        shopifyWebhookId: webhookId,
        status: "FAILED",
        attempts: 1,
        error: error.message,
      },
    });

    throw error;
  }
}

export async function reversePointsForCancelledOrder({
  shop,
  topic,
  webhookId,
  order,
}) {

  const resourceId = getOrderResourceId(order);
  const resourceName = getOrderResourceName(order);

  try {
    return await db.$transaction(async (tx) => {
      const existingEvent = await tx.webhookEvent.findUnique({
        where: {
          shop_topic_resourceId: {
            shop,
            topic,
            resourceId,
          },
        },
      });

      if (
        existingEvent?.status === "PROCESSED" ||
        existingEvent?.status === "SKIPPED"
      ) {
        return { status: "duplicate", resourceId };
      }

      await tx.webhookEvent.upsert({
        where: {
          shop_topic_resourceId: {
            shop,
            topic,
            resourceId,
          },
        },
        update: {
          resourceName,
          status: "PROCESSING",
          attempts: { increment: 1 },
          error: null,
        },
        create: {
          shop,
          topic,
          resourceId,
          resourceName,
          shopifyWebhookId: webhookId,
          status: "PROCESSING",
          attempts: 1,
        },
      });

      const earnedLedger = await tx.pointsLedger.findUnique({
        where: {
          shop_sourceType_sourceId: {
            shop,
            sourceType: ORDER_PAID_SOURCE_TYPE,
            sourceId: resourceId,
          },
        },
        include: {
          member: true,
          account: true,
        },
      });

      if (!earnedLedger) {
        await tx.webhookEvent.update({
          where: {
            shop_topic_resourceId: {
              shop,
              topic,
              resourceId,
            },
          },
          data: {
            resourceName,
            status: "SKIPPED",
            error: "No paid order points ledger found to reverse.",
            processedAt: new Date(),
          },
        });

        return { status: "skipped", resourceId, reason: "missing_earned_ledger" };
      }

      const existingCancelLedger = await tx.pointsLedger.findUnique({
        where: {
          shop_sourceType_sourceId: {
            shop,
            sourceType: ORDER_CANCELLED_SOURCE_TYPE,
            sourceId: resourceId,
          },
        },
      });

      if (existingCancelLedger) {
        await tx.webhookEvent.update({
          where: {
            shop_topic_resourceId: {
              shop,
              topic,
              resourceId,
            },
          },
          data: {
            resourceName,
            status: "PROCESSED",
            processedAt: new Date(),
          },
        });

        return { status: "duplicate", resourceId };
      }

      const pointsToReverse = earnedLedger.points;

      const nextBalance = earnedLedger.account.balance - pointsToReverse;

      const nextLifetimeEarned = Math.max(
        0,
        earnedLedger.account.lifetimeEarned - pointsToReverse,
      );

      const updatedAccount = await tx.pointsAccount.update({
        where: { id: earnedLedger.accountId },
        data: {
          balance: nextBalance,
          lifetimeEarned: nextLifetimeEarned,
        },
      });

      const levels = await getOrCreateDefaultLevelConfigs(shop, tx);
      const currentLevel = getLevelForPoints(levels, updatedAccount.lifetimeEarned);

      await tx.member.update({
        where: { id: earnedLedger.memberId },
        data: {
          currentLevelId: currentLevel?.id ?? null,
        },
      });

      const ledger = await tx.pointsLedger.create({
        data: {
          shop,
          memberId: earnedLedger.memberId,
          accountId: earnedLedger.accountId,
          type: "CANCEL",
          points: -pointsToReverse,
          balanceAfter: updatedAccount.balance,
          reason: "Order cancelled",
          sourceType: ORDER_CANCELLED_SOURCE_TYPE,
          sourceId: resourceId,
          metadataJson: JSON.stringify({
            orderName: order.name,
            reversedLedgerId: earnedLedger.id,
          }),
        },
      });

      await tx.webhookEvent.update({
        where: {
          shop_topic_resourceId: {
            shop,
            topic,
            resourceId,
          },
        },
        data: {
          resourceName,
          status: "PROCESSED",
          processedAt: new Date(),
        },
      });

      return {
        status: "processed",
        resourceId,
        points: -pointsToReverse,
        ledgerId: ledger.id,
      };
    });
  } catch (error) {
    await db.webhookEvent.upsert({
      where: {
        shop_topic_resourceId: {
          shop,
          topic,
          resourceId,
        },
      },
      update: {
        resourceName,
        status: "FAILED",
        attempts: { increment: 1 },
        error: error.message,
      },
      create: {
        shop,
        topic,
        resourceId,
        resourceName,
        shopifyWebhookId: webhookId,
        status: "FAILED",
        attempts: 1,
        error: error.message,
      },
    });

    throw error;
  }
}

export async function reversePointsForRefundedOrder({
  shop,
  topic,
  webhookId,
  order,
}) {
  const orderResourceId = getRefundOrderResourceId(order);
  const orderResourceName = getRefundResourceName(order, null);
  const refunds = getRefundEntries(order);

  if (refunds.length === 0) {
    await db.webhookEvent.upsert({
      where: {
        shop_topic_resourceId: {
          shop,
          topic,
          resourceId: orderResourceId,
        },
      },
      update: {
        resourceName: orderResourceName,
        status: "SKIPPED",
        attempts: { increment: 1 },
        error: "No refund entries found in payload.",
        processedAt: new Date(),
      },
      create: {
        shop,
        topic,
        resourceId: orderResourceId,
        resourceName: orderResourceName,
        shopifyWebhookId: webhookId,
        status: "SKIPPED",
        attempts: 1,
        error: "No refund entries found in payload.",
        processedAt: new Date(),
      },
    });

    return { status: "skipped", resourceId: orderResourceId, reason: "missing_refunds" };
  }

  try {
    return await db.$transaction(async (tx) => {
      const earnedLedger = await tx.pointsLedger.findUnique({
        where: {
          shop_sourceType_sourceId: {
            shop,
            sourceType: ORDER_PAID_SOURCE_TYPE,
            sourceId: orderResourceId,
          },
        },
        include: {
          account: true,
          member: true,
        },
      });

      const results = [];

      for (const refund of refunds) {
        const refundCents = getRefundAmountCents(refund);
        const refundResourceId = getRefundResourceId(
          orderResourceId,
          refund,
          refundCents,
        );
        const refundResourceName = getRefundResourceName(refund, earnedLedger);

        const existingEvent = await tx.webhookEvent.findUnique({
          where: {
            shop_topic_resourceId: {
              shop,
              topic,
              resourceId: refundResourceId,
            },
          },
        });

        if (
          existingEvent?.status === "PROCESSED" ||
          existingEvent?.status === "SKIPPED"
        ) {
          results.push({ status: "duplicate", resourceId: refundResourceId });
          continue;
        }

        await tx.webhookEvent.upsert({
          where: {
            shop_topic_resourceId: {
              shop,
              topic,
              resourceId: refundResourceId,
            },
          },
          update: {
            resourceName: refundResourceName,
            status: "PROCESSING",
            attempts: { increment: 1 },
            error: null,
          },
          create: {
            shop,
            topic,
            resourceId: refundResourceId,
            resourceName: refundResourceName,
            shopifyWebhookId: webhookId,
            status: "PROCESSING",
            attempts: 1,
          },
        });

        if (!earnedLedger) {
          await tx.webhookEvent.update({
            where: {
              shop_topic_resourceId: {
                shop,
                topic,
                resourceId: refundResourceId,
              },
            },
            data: {
              resourceName: refundResourceName,
              status: "SKIPPED",
              error: "No paid order points ledger found to refund.",
              processedAt: new Date(),
            },
          });

          results.push({
            status: "skipped",
            resourceId: refundResourceId,
            reason: "missing_earned_ledger",
          });
          continue;
        }

        if (refundCents <= 0) {
          await tx.webhookEvent.update({
            where: {
              shop_topic_resourceId: {
                shop,
                topic,
                resourceId: refundResourceId,
              },
            },
            data: {
              resourceName: refundResourceName,
              status: "SKIPPED",
              error: "Refund amount produced zero cents.",
              processedAt: new Date(),
            },
          });

          results.push({
            status: "skipped",
            resourceId: refundResourceId,
            reason: "zero_refund_amount",
          });
          continue;
        }

        const existingRefundLedger = await tx.pointsLedger.findUnique({
          where: {
            shop_sourceType_sourceId: {
              shop,
              sourceType: ORDER_REFUNDED_SOURCE_TYPE,
              sourceId: refundResourceId,
            },
          },
        });

        if (existingRefundLedger) {
          await tx.webhookEvent.update({
            where: {
              shop_topic_resourceId: {
                shop,
                topic,
                resourceId: refundResourceId,
              },
            },
            data: {
              resourceName: refundResourceName,
              status: "PROCESSED",
              processedAt: new Date(),
            },
          });

          results.push({ status: "duplicate", resourceId: refundResourceId });
          continue;
        }

        const previousRefundLedgers = await tx.pointsLedger.findMany({
          where: {
            shop,
            accountId: earnedLedger.accountId,
            sourceType: ORDER_REFUNDED_SOURCE_TYPE,
            sourceId: {
              startsWith: `${orderResourceId}:`,
            },
          },
        });
        const existingCancelLedger = await tx.pointsLedger.findUnique({
          where: {
            shop_sourceType_sourceId: {
              shop,
              sourceType: ORDER_CANCELLED_SOURCE_TYPE,
              sourceId: orderResourceId,
            },
          },
        });
        const alreadyRefundedPoints = previousRefundLedgers.reduce(
          (sum, ledger) => sum + Math.abs(ledger.points),
          0,
        );
        const alreadyCancelledPoints = existingCancelLedger
          ? Math.abs(existingCancelLedger.points)
          : 0;
        const remainingOrderPoints = Math.max(
          0,
          earnedLedger.points - alreadyRefundedPoints - alreadyCancelledPoints,
        );
        const rule = await getOrCreateRuleConfig(shop, tx);
        const calculatedPoints = calculateEarnedPoints(refundCents, rule);
        const pointsToReverse = Math.min(calculatedPoints, remainingOrderPoints);

        if (pointsToReverse <= 0) {
          await tx.webhookEvent.update({
            where: {
              shop_topic_resourceId: {
                shop,
                topic,
                resourceId: refundResourceId,
              },
            },
            data: {
              resourceName: refundResourceName,
              status: "SKIPPED",
              error: "No remaining order points to refund.",
              processedAt: new Date(),
            },
          });

          results.push({
            status: "skipped",
            resourceId: refundResourceId,
            reason: "zero_points",
          });
          continue;
        }

        const currentAccount = await tx.pointsAccount.findUnique({
          where: { id: earnedLedger.accountId },
        });
        const nextBalance = currentAccount.balance - pointsToReverse;
        const nextLifetimeEarned = Math.max(
          0,
          currentAccount.lifetimeEarned - pointsToReverse,
        );

        const updatedAccount = await tx.pointsAccount.update({
          where: { id: earnedLedger.accountId },
          data: {
            balance: nextBalance,
            lifetimeEarned: nextLifetimeEarned,
          },
        });

        const levels = await getOrCreateDefaultLevelConfigs(shop, tx);
        const currentLevel = getLevelForPoints(
          levels,
          updatedAccount.lifetimeEarned,
        );

        await tx.member.update({
          where: { id: earnedLedger.memberId },
          data: {
            currentLevelId: currentLevel?.id ?? null,
          },
        });

        const ledger = await tx.pointsLedger.create({
          data: {
            shop,
            memberId: earnedLedger.memberId,
            accountId: earnedLedger.accountId,
            type: "REFUND",
            points: -pointsToReverse,
            balanceAfter: updatedAccount.balance,
            reason: "Order refunded",
            sourceType: ORDER_REFUNDED_SOURCE_TYPE,
            sourceId: refundResourceId,
            metadataJson: JSON.stringify({
              orderResourceId,
              orderName: refundResourceName,
              refundCents,
              refundId:
                refund?.admin_graphql_api_id ||
                refund?.id ||
                refund?.created_at ||
                refund?.processed_at,
              reversedLedgerId: earnedLedger.id,
            }),
          },
        });

        await tx.webhookEvent.update({
          where: {
            shop_topic_resourceId: {
              shop,
              topic,
              resourceId: refundResourceId,
            },
          },
          data: {
              resourceName: refundResourceName,
            status: "PROCESSED",
            processedAt: new Date(),
          },
        });

        results.push({
          status: "processed",
          resourceId: refundResourceId,
          points: -pointsToReverse,
          ledgerId: ledger.id,
        });
      }

      const processed = results.filter((result) => result.status === "processed");

      return {
        status: processed.length > 0 ? "processed" : "skipped",
        resourceId: orderResourceId,
        results,
      };
    });
  } catch (error) {
    await db.webhookEvent.upsert({
      where: {
        shop_topic_resourceId: {
          shop,
          topic,
          resourceId: orderResourceId,
        },
      },
      update: {
        resourceName: orderResourceName,
        status: "FAILED",
        attempts: { increment: 1 },
        error: error.message,
      },
      create: {
        shop,
        topic,
        resourceId: orderResourceId,
        resourceName: orderResourceName,
        shopifyWebhookId: webhookId,
        status: "FAILED",
        attempts: 1,
        error: error.message,
      },
    });

    throw error;
  }
}
