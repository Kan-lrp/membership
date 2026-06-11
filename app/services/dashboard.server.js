import db from "../db.server";
import { DEFAULT_RULE, MEMBER_STATUS } from "./constants.server";
import {
  getOrCreateDefaultLevelConfigs,
  serializeLevel,
} from "./levels.server";
import { serializeMemberAccount } from "./members.server";
import { hydrateLedgerOrderNames } from "./shared.server";
import {
  currencyUnitCentsToYuan,
  currencyUnitYuanToCents,
  parsePositiveInteger,
} from "../utils/money.server";

// 这个文件服务 Shopify Admin 里的“会员积分首页”。
// 主要负责：
// 1. 读取首页概览数据
// 2. 读取最近会员、最近积分流水
// 3. 保存积分发放规则
// 注意：这里不要写订单 webhook 的处理逻辑，订单相关逻辑放 orders.server.js。

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
    // 首页是经营看板，只统计已开通 ACTIVE 会员。
    // PENDING/INACTIVE 仍会在会员列表里展示，但不计入首页 KPI。
    db.member.count({
      where: {
        shop,
        status: MEMBER_STATUS.ACTIVE,
      },
    }),

    // aggregate 是 Prisma 聚合查询，这里一次性求余额、累计发放、累计消耗的总和。
    db.pointsAccount.aggregate({
      where: {
        shop,
        member: {
          status: MEMBER_STATUS.ACTIVE,
        },
      },
      _sum: {
        balance: true,
        lifetimeEarned: true,
        lifetimeSpent: true,
      },
    }),

    // 最近积分流水，用于后台“最近积分流水”表格。
    // include: { member: true } 表示查询流水时顺便把关联会员也查出来。
    db.pointsLedger.findMany({
      where: { shop },
      include: { member: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),

    // 最近更新的 10 个积分账户，用于后台“最近会员”表格。
    db.pointsAccount.findMany({
      where: {
        shop,
        member: {
          status: MEMBER_STATUS.ACTIVE,
        },
      },
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
  const hydratedRecentLedgers = await hydrateLedgerOrderNames(shop, recentLedgers);

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
    recentLedgers: hydratedRecentLedgers,
    members: recentMemberAccounts.map((account) =>
      serializeMemberAccount(account, levels),
    ),
  };
}
