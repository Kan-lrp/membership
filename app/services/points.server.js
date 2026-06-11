import { randomUUID } from "node:crypto";
import db from "../db.server";
import { MANUAL_ADJUSTMENT_SOURCE_TYPE } from "./constants.server";
import {
  getLevelForPoints,
  getOrCreateDefaultLevelConfigs,
} from "./levels.server";

// 这个文件负责“人工积分操作”。
// 主要负责：
// 1. 商家在会员详情页手动加分
// 2. 商家在会员详情页手动扣分
// 3. 写 ADJUST 积分流水
// 4. 写人工时间线记录
// 注意：订单付款、退款、取消产生的积分变化不放这里，而是放 orders.server.js。

export async function adjustMemberPoints({ shop, memberId, points, reason, actor }) {
  // 手动调分入口。
  // points 可以是正数也可以是负数：正数表示加分，负数表示扣分。
  const adjustmentPoints = Number.parseInt(points, 10);
  // 原因也先统一转成字符串并 trim，避免用户只输入空格也算通过。
  const normalizedReason = String(reason ?? "").trim();

  if (!Number.isFinite(adjustmentPoints) || adjustmentPoints === 0) {
    throw new Error("调整积分必须是非 0 整数。");
  }

  // 虽然前端表单已经加了 required，但后端仍然必须校验。
  // 因为别人可以绕过浏览器表单，直接请求这个 action。
  if (!normalizedReason) {
    throw new Error("请填写调整原因。");
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
        // 手动调分原因必须写进流水，后续客服/商家查账时才知道为什么加扣分。
        reason: normalizedReason,
        sourceType: MANUAL_ADJUSTMENT_SOURCE_TYPE,
        sourceId: `manual:${randomUUID()}`,
        metadataJson: JSON.stringify({
          reason: normalizedReason,
        }),
      },
    });

    await tx.memberTimelineEvent.create({
      data: {
        shop,
        memberId,
        type: "MANUAL_ADJUST",
        title: `手动${adjustmentPoints > 0 ? "增加" : "扣减"} ${Math.abs(
          adjustmentPoints,
        )} 积分`,
        content: normalizedReason,
        actorName: actor?.actorName || "Merchant",
        actorEmail: actor?.actorEmail || null,
        actorUserId: actor?.actorUserId || null,
        metadataJson: JSON.stringify({
          points: adjustmentPoints,
          reason: normalizedReason,
          ledgerId: ledger.id,
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
