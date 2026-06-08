import { randomUUID } from "node:crypto";
import db from "../db.server.js";

// MVP 默认规则：每消费 10 个货币单位发 1 积分。
// 这里用 cents 保存单位，避免直接用小数金额计算导致精度问题。
const DEFAULT_RULE = {
  pointsPerCurrencyUnit: 1,
  currencyUnitCents: 1000,
  isEnabled: true,
};

// MVP 默认等级配置。
// thresholdPoints 表示累计获得积分达到多少后进入该等级。
const DEFAULT_LEVELS = [
  { name: "普通会员", thresholdPoints: 0, sortOrder: 1 },
  { name: "银卡会员", thresholdPoints: 100, sortOrder: 2 },
  { name: "金卡会员", thresholdPoints: 500, sortOrder: 3 },
  { name: "黑金会员", thresholdPoints: 2000, sortOrder: 4 },
];

// 积分流水的业务来源类型。后续退款扣回、手动调整可以继续加新的 sourceType。
const ORDER_PAID_SOURCE_TYPE = "ORDER_PAID";
// 订单取消时使用这个来源类型。
// 它和 ORDER_PAID 共用同一个 order id，但 sourceType 不同，所以可以分别保存“发放”和“冲回”两条流水。
const ORDER_CANCELLED_SOURCE_TYPE = "ORDER_CANCELLED";
// 商家在后台手动加分/扣分时使用这个来源类型。
// 每次手动调整都会生成一个新的 sourceId，所以每次调整都会留下独立流水。
const MANUAL_ADJUSTMENT_SOURCE_TYPE = "MANUAL_ADJUSTMENT";

function parsePositiveInteger(value, fallback) {
  // HTML 表单提交过来的值通常是字符串，这里把它转成整数。
  // 如果转出来不是合法数字，就使用 fallback 默认值。
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseIntegerAtLeast(value, fallback, minimum) {
  // 和 parsePositiveInteger 类似，但这里可以指定最小值。
  // “每消费 N 元”的 N 不能为 0，否则积分计算会除以 0。
  const parsed = parsePositiveInteger(value, fallback);
  return Math.max(parsed, minimum);
}

function currencyUnitYuanToCents(value) {
  // 前端给商家看的是“元”，数据库里保存的是“分”。
  // 例如表单填 10，数据库保存 1000。
  return parseIntegerAtLeast(value, DEFAULT_RULE.currencyUnitCents / 100, 1) * 100;
}

function currencyUnitCentsToYuan(value) {
  // 把数据库里的“分”转回页面好理解的“元”。
  return Math.max(1, Math.floor(value / 100));
}

function formatMemberName(member) {
  // 后台列表优先显示顾客姓名；没有姓名时显示邮箱；再没有就显示 customerId。
  const name = [member.firstName, member.lastName].filter(Boolean).join(" ");
  return name || member.email || member.customerId;
}

function getOrderResourceId(order) {
  // 同一个订单可能从 REST webhook 带 numeric id，也可能带 GraphQL gid。
  // 优先用 admin_graphql_api_id，因为它在 Shopify GraphQL 体系里更稳定。
  const resourceId = order?.admin_graphql_api_id || order?.id;

  if (!resourceId) {
    throw new Error("Order webhook payload is missing an order id.");
  }

  return String(resourceId);
}

function getCustomerId(customer) {
  // 优先使用 GraphQL gid；没有时退回 REST payload 里的 numeric id。
  const customerId = customer?.admin_graphql_api_id || customer?.id;
  return customerId ? String(customerId) : null;
}

function getOrderTotalCents(order) {
  // current_total_price 是订单当前实付金额；没有时退回 total_price。
  return parseMoneyToCents(order?.current_total_price ?? order?.total_price);
}

function serializeRule(rule) {
  // Prisma 返回的是完整数据库记录；前端只需要这几个字段。
  // 这样可以避免把不必要的数据库字段暴露给页面。
  return {
    pointsPerCurrencyUnit: rule.pointsPerCurrencyUnit,
    currencyUnitCents: rule.currencyUnitCents,
    currencyUnitYuan: currencyUnitCentsToYuan(rule.currencyUnitCents),
    isEnabled: rule.isEnabled,
  };
}

function serializeLevel(level) {
  // 等级配置给前端展示时，只需要名称、门槛和排序。
  return {
    id: level.id,
    name: level.name,
    thresholdPoints: level.thresholdPoints,
    sortOrder: level.sortOrder,
  };
}

function getLevelForPoints(levels, lifetimeEarned) {
  // 从低到高找，最后一个满足 thresholdPoints <= 累计积分的等级就是当前等级。
  // 例如累计 600 分，会依次命中普通、银卡、金卡，最终返回金卡。
  return levels.reduce((matchedLevel, level) => {
    if (lifetimeEarned >= level.thresholdPoints) {
      return level;
    }

    return matchedLevel;
  }, levels[0]);
}

function getNextLevelForPoints(levels, lifetimeEarned) {
  // 找到第一个门槛高于当前累计积分的等级，就是“下一等级”。
  // 如果找不到，说明已经是最高等级。
  return levels.find((level) => lifetimeEarned < level.thresholdPoints) ?? null;
}

function serializeLedger(ledger) {
  // 把积分流水转换成前端表格需要的格式。
  // 这里顺手把 Date 转成字符串，因为浏览器端更容易处理字符串。
  return {
    id: ledger.id,
    customerName: formatMemberName(ledger.member),
    customerEmail: ledger.member.email,
    type: ledger.type,
    points: ledger.points,
    balanceAfter: ledger.balanceAfter,
    reason: ledger.reason,
    sourceId: ledger.sourceId,
    createdAt: ledger.createdAt.toISOString(),
  };
}

function serializeMemberAccount(account, levels) {
  // pointsAccount 查询时 include 了 member，所以这里可以同时拿到账户和会员信息。
  const level =
    account.member.currentLevel ?? getLevelForPoints(levels, account.lifetimeEarned);

  return {
    id: account.member.id,
    customerId: account.member.customerId,
    name: formatMemberName(account.member),
    email: account.member.email,
    levelName: level?.name ?? "普通会员",
    levelThresholdPoints: level?.thresholdPoints ?? 0,
    balance: account.balance,
    lifetimeEarned: account.lifetimeEarned,
    lifetimeSpent: account.lifetimeSpent,
    updatedAt: account.updatedAt.toISOString(),
  };
}

function serializeMemberWithAccount(member, levels) {
  // 会员列表页直接查 Member，所以这里从 member.pointsAccount 里拿积分账户。
  // 如果某个会员暂时还没有积分账户，就把余额和累计值显示为 0。
  const account = member.pointsAccount;
  const lifetimeEarned = account?.lifetimeEarned ?? 0;
  const level = member.currentLevel ?? getLevelForPoints(levels, lifetimeEarned);
  const nextLevel = getNextLevelForPoints(levels, lifetimeEarned);
  const latestLedger = member.pointsLedgers?.[0];

  return {
    id: member.id,
    customerId: member.customerId,
    name: formatMemberName(member),
    email: member.email,
    levelName: level?.name ?? "普通会员",
    levelThresholdPoints: level?.thresholdPoints ?? 0,
    nextLevelName: nextLevel?.name ?? null,
    pointsToNextLevel: nextLevel
      ? Math.max(0, nextLevel.thresholdPoints - lifetimeEarned)
      : 0,
    balance: account?.balance ?? 0,
    lifetimeEarned,
    lifetimeSpent: account?.lifetimeSpent ?? 0,
    ledgerCount: member._count?.pointsLedgers ?? 0,
    latestLedger: latestLedger
      ? {
          type: latestLedger.type,
          points: latestLedger.points,
          reason: latestLedger.reason,
          createdAt: latestLedger.createdAt.toISOString(),
        }
      : null,
    createdAt: member.createdAt.toISOString(),
    updatedAt: (account?.updatedAt ?? member.updatedAt).toISOString(),
  };
}

function serializeWebhookEvent(event) {
  // 日志页只需要展示处理状态、topic、资源 id、错误原因和时间。
  return {
    id: event.id,
    shop: event.shop,
    topic: event.topic,
    resourceId: event.resourceId,
    status: event.status,
    attempts: event.attempts,
    error: event.error,
    receivedAt: event.receivedAt.toISOString(),
    processedAt: event.processedAt?.toISOString() ?? null,
  };
}

export function parseMoneyToCents(value) {
  // Shopify 金额通常是字符串，例如 "128.50"；先转成分再参与积分计算。
  const normalized = String(value ?? "0").trim().replace(/,/g, "");

  if (!normalized) {
    return 0;
  }

  const sign = normalized.startsWith("-") ? -1 : 1;
  const unsigned = normalized.replace(/^-/, "");
  const [whole = "0", decimal = ""] = unsigned.split(".");
  const wholeCents = Number.parseInt(whole || "0", 10) * 100;
  const decimalCents = Number.parseInt(decimal.padEnd(2, "0").slice(0, 2), 10);

  if (!Number.isFinite(wholeCents) || !Number.isFinite(decimalCents)) {
    return 0;
  }

  return sign * (wholeCents + decimalCents);
}

export function calculateEarnedPoints(totalCents, rule) {
  // 规则关闭、订单金额小于等于 0、或者规则单位异常时都不发积分。
  if (!rule.isEnabled || totalCents <= 0 || rule.currencyUnitCents <= 0) {
    return 0;
  }

  return Math.floor(
    (totalCents * rule.pointsPerCurrencyUnit) / rule.currencyUnitCents,
  );
}

export async function getOrCreateRuleConfig(shop, client = db) {
  // 每个店铺只有一份规则；首次打开后台或首次 webhook 到达时自动创建默认规则。
  // upsert = 有就 update，没有就 create。这里 update 为空对象，表示存在时不改动。
  return client.ruleConfig.upsert({
    where: { shop },
    update: {},
    create: {
      shop,
      ...DEFAULT_RULE,
    },
  });
}

export async function getOrCreateDefaultLevelConfigs(shop, client = db) {
  // MVP 先用固定四档等级。每次读取前 upsert 一遍，可以保证新店铺首次打开时自动有默认等级。
  // 后续做“等级规则配置”页面时，可以把这里改成只在初始化时创建。
  await Promise.all(
    DEFAULT_LEVELS.map((level) =>
      client.levelConfig.upsert({
        where: {
          shop_name: {
            shop,
            name: level.name,
          },
        },
        update: {
          thresholdPoints: level.thresholdPoints,
          sortOrder: level.sortOrder,
        },
        create: {
          shop,
          ...level,
        },
      }),
    ),
  );

  return client.levelConfig.findMany({
    where: { shop },
    orderBy: { thresholdPoints: "asc" },
  });
}

export async function updateRuleConfig(
  shop,
  { pointsPerCurrencyUnit, currencyUnitYuan, isEnabled },
) {
  // 表单提交的是字符串，这里统一清洗成非负整数，避免把非法值写进规则。
  const normalizedPoints = parsePositiveInteger(
    pointsPerCurrencyUnit,
    DEFAULT_RULE.pointsPerCurrencyUnit,
  );
  const normalizedCurrencyUnitCents = currencyUnitYuanToCents(currencyUnitYuan);

  return db.ruleConfig.upsert({
    // shop 是唯一字段，所以可以用它定位当前店铺的规则。
    where: { shop },
    update: {
      pointsPerCurrencyUnit: normalizedPoints,
      currencyUnitCents: normalizedCurrencyUnitCents,
      isEnabled,
    },
    create: {
      shop,
      ...DEFAULT_RULE,
      pointsPerCurrencyUnit: normalizedPoints,
      currencyUnitCents: normalizedCurrencyUnitCents,
      isEnabled,
    },
  });
}

export async function getDashboardData(shop) {
  // 这个函数专门服务 App Home 页面，不负责改数据，只负责整理页面需要的数据。
  const [rule, levels] = await Promise.all([
    getOrCreateRuleConfig(shop),
    getOrCreateDefaultLevelConfigs(shop),
  ]);

  // Dashboard 需要的汇总数据彼此独立，可以并发读取。
  const [
    memberCount,
    accountTotals,
    recentLedgers,
    recentMemberAccounts,
  ] = await Promise.all([
    // 会员总数。
    db.member.count({ where: { shop } }),

    // aggregate 是 Prisma 聚合查询，这里一次性求余额、累计发放、累计消耗的总和。
    db.pointsAccount.aggregate({
      where: { shop },
      _sum: {
        balance: true,
        lifetimeEarned: true,
        lifetimeSpent: true,
      },
    }),

    // 最近 10 条积分流水，用于后台“最近积分流水”表格。
    // include: { member: true } 表示查询流水时顺便把关联会员也查出来。
    db.pointsLedger.findMany({
      where: { shop },
      include: { member: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),

    // 最近更新的 10 个积分账户，用于后台“最近会员”表格。
    db.pointsAccount.findMany({
      where: { shop },
      include: {
        member: {
          include: {
            currentLevel: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
  ]);

  return {
    // 返回给 React 页面的数据尽量整理成页面直接能用的形状。
    rule: serializeRule(rule),
    levels: levels.map(serializeLevel),
    summary: {
      memberCount,
      totalBalance: accountTotals._sum.balance ?? 0,
      lifetimeEarned: accountTotals._sum.lifetimeEarned ?? 0,
      lifetimeSpent: accountTotals._sum.lifetimeSpent ?? 0,
    },
    recentLedgers: recentLedgers.map(serializeLedger),
    members: recentMemberAccounts.map((account) =>
      serializeMemberAccount(account, levels),
    ),
  };
}

export async function getMembersData(shop) {
  // 会员列表页的数据来源是 Member。
  // include pointsAccount/currentLevel 表示把积分账户和当前等级一起查出来，页面就不用再发多次请求。
  const levels = await getOrCreateDefaultLevelConfigs(shop);
  const members = await db.member.findMany({
    where: { shop },
    include: {
      currentLevel: true,
      pointsAccount: true,
      pointsLedgers: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      _count: {
        select: {
          pointsLedgers: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  return {
    members: members.map((member) => serializeMemberWithAccount(member, levels)),
  };
}

export async function getMemberDetailData(shop, memberId) {
  // 单会员详情页：查会员基础信息、积分账户、当前等级和最近流水。
  const [levels, member] = await Promise.all([
    getOrCreateDefaultLevelConfigs(shop),
    db.member.findFirst({
      where: {
        id: memberId,
        shop,
      },
      include: {
        currentLevel: true,
        pointsAccount: true,
        pointsLedgers: {
          orderBy: { createdAt: "desc" },
          take: 50,
        },
      },
    }),
  ]);

  if (!member) {
    throw new Response("Member not found", { status: 404 });
  }

  const account = member.pointsAccount;
  const lifetimeEarned = account?.lifetimeEarned ?? 0;
  const level = member.currentLevel ?? getLevelForPoints(levels, lifetimeEarned);

  return {
    member: {
      id: member.id,
      customerId: member.customerId,
      name: formatMemberName(member),
      email: member.email,
      levelName: level?.name ?? "普通会员",
      balance: account?.balance ?? 0,
      lifetimeEarned,
      lifetimeSpent: account?.lifetimeSpent ?? 0,
      updatedAt: member.updatedAt.toISOString(),
    },
    ledgers: member.pointsLedgers.map((ledger) => ({
      id: ledger.id,
      type: ledger.type,
      points: ledger.points,
      balanceAfter: ledger.balanceAfter,
      reason: ledger.reason,
      sourceType: ledger.sourceType,
      sourceId: ledger.sourceId,
      createdAt: ledger.createdAt.toISOString(),
    })),
  };
}

export async function adjustMemberPoints({ shop, memberId, points, reason }) {
  // 手动调分入口。
  // points 可以是正数也可以是负数：正数表示加分，负数表示扣分。
  const adjustmentPoints = Number.parseInt(points, 10);

  if (!Number.isFinite(adjustmentPoints) || adjustmentPoints === 0) {
    throw new Error("调整积分必须是非 0 整数。");
  }

  return db.$transaction(async (tx) => {
    const member = await tx.member.findFirst({
      where: {
        id: memberId,
        shop,
      },
    });

    if (!member) {
      throw new Error("会员不存在。");
    }

    const account = await tx.pointsAccount.upsert({
      where: {
        shop_memberId: {
          shop,
          memberId,
        },
      },
      update: {},
      create: {
        shop,
        memberId,
      },
    });

    const nextBalance = account.balance + adjustmentPoints;

    if (nextBalance < 0) {
      throw new Error("积分余额不足，不能扣成负数。");
    }

    // 手动加分会增加累计获得积分；手动扣分会把累计获得积分同步调低。
    // 这样等级会跟着人工修正后的累计积分重新计算。
    const nextLifetimeEarned =
      adjustmentPoints > 0
        ? account.lifetimeEarned + adjustmentPoints
        : Math.max(0, account.lifetimeEarned + adjustmentPoints);

    const updatedAccount = await tx.pointsAccount.update({
      where: { id: account.id },
      data: {
        balance: nextBalance,
        lifetimeEarned: nextLifetimeEarned,
      },
    });

    const levels = await getOrCreateDefaultLevelConfigs(shop, tx);
    const currentLevel = getLevelForPoints(levels, updatedAccount.lifetimeEarned);

    await tx.member.update({
      where: { id: memberId },
      data: {
        currentLevelId: currentLevel?.id ?? null,
      },
    });

    const ledger = await tx.pointsLedger.create({
      data: {
        shop,
        memberId,
        accountId: account.id,
        type: "ADJUST",
        points: adjustmentPoints,
        balanceAfter: updatedAccount.balance,
        reason: reason?.trim() || "Manual adjustment",
        sourceType: MANUAL_ADJUSTMENT_SOURCE_TYPE,
        sourceId: `manual:${randomUUID()}`,
        metadataJson: JSON.stringify({
          reason: reason?.trim() || "Manual adjustment",
        }),
      },
    });

    return {
      status: "processed",
      points: adjustmentPoints,
      ledgerId: ledger.id,
    };
  });
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

export async function awardPointsForPaidOrder({
  shop,
  topic,
  webhookId,
  order,
}) {
  // resourceId 是幂等判断的核心：同一个订单支付事件重复到达时 id 不变。
  const resourceId = getOrderResourceId(order);

  try {
    // 会员、账户、余额、流水和 webhook 状态必须在同一个事务里更新。
    // 任意一步失败都会回滚，避免出现“余额加了但流水没写”这类账务不一致。
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
        // Shopify webhook 可能重试；已经处理或明确跳过的事件直接返回，不再发积分。
        return { status: "duplicate", resourceId };
      }

      // 第一层幂等记录：标记这个 webhook 事件正在处理，并累计尝试次数。
      await tx.webhookEvent.upsert({
        where: {
          shop_topic_resourceId: {
            shop,
            topic,
            resourceId,
          },
        },
        update: {
          status: "PROCESSING",
          attempts: { increment: 1 },
          error: null,
        },
        create: {
          shop,
          topic,
          resourceId,
          shopifyWebhookId: webhookId,
          status: "PROCESSING",
          attempts: 1,
        },
      });

      const customer = order.customer;
      const customerId = getCustomerId(customer);

      if (!customerId) {
        // 没有 customer 的订单不能归属到会员账户，记录为 SKIPPED 方便后台排查。
        await tx.webhookEvent.update({
          where: {
            shop_topic_resourceId: {
              shop,
              topic,
              resourceId,
            },
          },
          data: {
            status: "SKIPPED",
            error: "Order has no customer.",
            processedAt: new Date(),
          },
        });

        return { status: "skipped", resourceId, reason: "missing_customer" };
      }

      const rule = await getOrCreateRuleConfig(shop, tx);
      const totalCents = getOrderTotalCents(order);
      // 根据订单金额和当前店铺积分规则算出本次应发积分。
      const points = calculateEarnedPoints(totalCents, rule);

      if (points <= 0) {
        // 规则关闭或积分计算为 0 时不写流水，但事件状态要落库。
        await tx.webhookEvent.update({
          where: {
            shop_topic_resourceId: {
              shop,
              topic,
              resourceId,
            },
          },
          data: {
            status: "SKIPPED",
            error: rule.isEnabled
              ? "Order total produced zero points."
              : "Points rule is disabled.",
            processedAt: new Date(),
          },
        });

        return { status: "skipped", resourceId, reason: "zero_points" };
      }

      const member = await tx.member.upsert({
        // shop_customerId 来自 schema.prisma 里的 @@unique([shop, customerId])。
        // 它保证同一个店铺里的同一个顾客只会有一条 Member。
        where: {
          shop_customerId: {
            shop,
            customerId,
          },
        },
        update: {
          // 如果会员已经存在，用 webhook 里最新的顾客资料更新基础信息。
          email: customer.email ?? order.email ?? null,
          firstName: customer.first_name ?? null,
          lastName: customer.last_name ?? null,
        },
        create: {
          // 如果会员不存在，就用订单里的 customer 创建一个新会员。
          shop,
          customerId,
          email: customer.email ?? order.email ?? null,
          firstName: customer.first_name ?? null,
          lastName: customer.last_name ?? null,
        },
      });

      // 一个会员只有一个积分账户；重复 webhook 不会重复建账户。
      const account = await tx.pointsAccount.upsert({
        // shop_memberId 来自 schema.prisma 里的 @@unique([shop, memberId])。
        // 它保证同一个会员不会重复创建多个积分账户。
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
        // 查询是否已经为这笔订单写过 ORDER_PAID 流水。
        // 这是防止重复发积分的关键检查之一。
        where: {
          shop_sourceType_sourceId: {
            shop,
            sourceType: ORDER_PAID_SOURCE_TYPE,
            sourceId: resourceId,
          },
        },
      });

      if (existingLedger) {
        // 第二层幂等检查：即使 webhook 状态异常，流水唯一约束也能防止重复入账。
        await tx.webhookEvent.update({
          where: {
            shop_topic_resourceId: {
              shop,
              topic,
              resourceId,
            },
          },
          data: {
            status: "PROCESSED",
            processedAt: new Date(),
          },
        });

        return { status: "duplicate", resourceId };
      }

      const updatedAccount = await tx.pointsAccount.update({
        where: { id: account.id },
        data: {
          // increment 是 Prisma 的原子自增写法，比先读再写更安全。
          balance: { increment: points },
          lifetimeEarned: { increment: points },
        },
      });

      const levels = await getOrCreateDefaultLevelConfigs(shop, tx);
      const currentLevel = getLevelForPoints(levels, updatedAccount.lifetimeEarned);

      if (currentLevel && member.currentLevelId !== currentLevel.id) {
        // 订单发积分后，按累计获得积分自动更新会员等级。
        // 例如累计积分从 90 增加到 120，会从普通会员升级为银卡会员。
        await tx.member.update({
          where: { id: member.id },
          data: {
            currentLevelId: currentLevel.id,
          },
        });
      }

      const ledger = await tx.pointsLedger.create({
        // 余额更新成功后立刻写流水，并记录变动后的余额。
        // 以后做对账时，可以用流水还原每次积分变化。
        data: {
          shop,
          memberId: member.id,
          accountId: account.id,
          type: "EARN",
          points,
          balanceAfter: updatedAccount.balance,
          reason: "Order paid",
          // sourceType + sourceId 对应 schema 里的唯一索引，是积分流水的入账幂等键。
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
        // 到这里说明会员、账户、余额和流水都已经写成功，可以把事件标记为已处理。
        where: {
          shop_topic_resourceId: {
            shop,
            topic,
            resourceId,
          },
        },
        data: {
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
    // 失败也记录 webhook 事件，便于后续做异常列表和重试工具。
    await db.webhookEvent.upsert({
      // 如果事务中途失败，把状态写成 FAILED。
      // 后续做“异常处理”页面时，可以从 WebhookEvent 里筛选这些失败记录。
      where: {
        shop_topic_resourceId: {
          shop,
          topic,
          resourceId,
        },
      },
      update: {
        status: "FAILED",
        attempts: { increment: 1 },
        error: error.message,
      },
      create: {
        shop,
        topic,
        resourceId,
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
  // 这个函数专门处理“订单取消后扣回积分”。
  // 注意：这里不是删除原来的发积分流水，而是新增一条负数流水。
  // 原因是财务/积分系统通常要保留完整账本：先发了多少、后来为什么扣回，都要能查到。

  // 取消订单和支付订单用同一个 Shopify order id 做业务关联。
  // 这样才能找到之前 ORDER_PAID 发出去的那笔积分。
  const resourceId = getOrderResourceId(order);

  try {
    // 积分扣回同样放在事务里。
    // 如果中间任何一步失败，余额、流水、等级、webhook 状态都会一起回滚，避免账本不一致。
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
        // Shopify webhook 可能重试；已经处理过的取消事件不能重复扣积分。
        return { status: "duplicate", resourceId };
      }

      // 第一层幂等：先记录这个 orders/cancelled webhook 正在处理。
      // 如果 Shopify 重发同一个取消事件，后面会通过 WebhookEvent 判断它已经处理过。
      await tx.webhookEvent.upsert({
        where: {
          shop_topic_resourceId: {
            shop,
            topic,
            resourceId,
          },
        },
        update: {
          status: "PROCESSING",
          attempts: { increment: 1 },
          error: null,
        },
        create: {
          shop,
          topic,
          resourceId,
          shopifyWebhookId: webhookId,
          status: "PROCESSING",
          attempts: 1,
        },
      });

      const earnedLedger = await tx.pointsLedger.findUnique({
        // 先找同一笔订单的 ORDER_PAID 流水。
        // 只有找到了原始发放流水，才知道应该扣回多少积分、扣哪个会员账户。
        where: {
          shop_sourceType_sourceId: {
            shop,
            sourceType: ORDER_PAID_SOURCE_TYPE,
            sourceId: resourceId,
          },
        },
        include: {
          // include account 是为了拿到当前余额和累计获得积分。
          member: true,
          account: true,
        },
      });

      if (!earnedLedger) {
        // 如果取消事件先到，或者这笔订单原本没发过积分，就只记录跳过。
        // 这种情况不能盲目扣积分，否则可能扣错会员。
        await tx.webhookEvent.update({
          where: {
            shop_topic_resourceId: {
              shop,
              topic,
              resourceId,
            },
          },
          data: {
            status: "SKIPPED",
            error: "No paid order points ledger found to reverse.",
            processedAt: new Date(),
          },
        });

        return { status: "skipped", resourceId, reason: "missing_earned_ledger" };
      }

      const existingCancelLedger = await tx.pointsLedger.findUnique({
        // 第二层幂等：检查这笔订单是否已经写过 ORDER_CANCELLED 流水。
        // WebhookEvent 是事件层防重复，PointsLedger 是账本层防重复，两层一起更稳。
        where: {
          shop_sourceType_sourceId: {
            shop,
            sourceType: ORDER_CANCELLED_SOURCE_TYPE,
            sourceId: resourceId,
          },
        },
      });

      if (existingCancelLedger) {
        // 第二层幂等：即使 webhook 事件状态异常，取消流水也只能写一次。
        await tx.webhookEvent.update({
          where: {
            shop_topic_resourceId: {
              shop,
              topic,
              resourceId,
            },
          },
          data: {
            status: "PROCESSED",
            processedAt: new Date(),
          },
        });

        return { status: "duplicate", resourceId };
      }

      // 原始发放流水 points 是正数，例如 120。
      // 取消订单时要扣回同样数量，所以后面会写 -120。
      const pointsToReverse = earnedLedger.points;

      // 余额扣回：当前余额 - 原订单发放积分。
      // 如果用户已经花掉了积分，余额可能会变成负数；这能提醒商家后续需要处理。
      const nextBalance = earnedLedger.account.balance - pointsToReverse;

      // 累计获得积分也要扣回，否则取消订单后等级还会被虚高积分撑着。
      // Math.max(0, ...) 是为了避免累计获得积分变成负数。
      const nextLifetimeEarned = Math.max(
        0,
        earnedLedger.account.lifetimeEarned - pointsToReverse,
      );

      const updatedAccount = await tx.pointsAccount.update({
        where: { id: earnedLedger.accountId },
        data: {
          // 取消订单要把余额和累计获得积分都冲回。
          // balance 允许暂时为负数，表示会员已经使用过积分但订单又取消了。
          balance: nextBalance,
          lifetimeEarned: nextLifetimeEarned,
        },
      });

      const levels = await getOrCreateDefaultLevelConfigs(shop, tx);
      // 积分扣回后，累计获得积分可能下降，所以等级也要重新计算。
      const currentLevel = getLevelForPoints(levels, updatedAccount.lifetimeEarned);

      await tx.member.update({
        where: { id: earnedLedger.memberId },
        data: {
          // 积分冲回后也要重新计算等级，可能会从金卡降回银卡。
          currentLevelId: currentLevel?.id ?? null,
        },
      });

      const ledger = await tx.pointsLedger.create({
        // 写一条负数流水，而不是修改或删除原来的 EARN 流水。
        // 这样后台最近流水里会看到两条记录：Order paid +120、Order cancelled -120。
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
            // 记录被冲回的原始流水 id，方便以后做详情页或排查。
            reversedLedgerId: earnedLedger.id,
          }),
        },
      });

      await tx.webhookEvent.update({
        // 所有扣回动作都成功后，才把 webhook 事件标记为 PROCESSED。
        where: {
          shop_topic_resourceId: {
            shop,
            topic,
            resourceId,
          },
        },
        data: {
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
    // 如果扣回过程中出错，也要把失败写进 WebhookEvent。
    // 后续做“日志/异常处理”页面时，可以把 FAILED 事件列出来给商家或开发者排查。
    await db.webhookEvent.upsert({
      where: {
        shop_topic_resourceId: {
          shop,
          topic,
          resourceId,
        },
      },
      update: {
        status: "FAILED",
        attempts: { increment: 1 },
        error: error.message,
      },
      create: {
        shop,
        topic,
        resourceId,
        shopifyWebhookId: webhookId,
        status: "FAILED",
        attempts: 1,
        error: error.message,
      },
    });

    throw error;
  }
}
