import db from "../db.server";
import { MEMBER_STATUS } from "./constants.server";
import {
  getDisplayLevel,
  getLevelForPoints,
  getNextLevelForPoints,
  getOrCreateDefaultLevelConfigs,
} from "./levels.server";
import {
  formatMemberName,
  hydrateLedgerOrderNames,
  serializeTimelineEvent,
} from "./shared.server";

// 这个文件负责“会员资料”。
// 主要负责：
// 1. 会员列表
// 2. 会员详情
// 3. 会员状态 PENDING / ACTIVE / INACTIVE 的切换
// 4. 给页面整理会员详情需要的数据
// 注意：这里不直接处理订单 webhook，也不直接处理退款。

export function serializeMemberAccount(account, levels) {
  // pointsAccount 查询时 include 了 member，所以这里可以同时拿到账户和会员信息。
  const level = getDisplayLevel(account.member, levels, account.lifetimeEarned);

  return {
    id: account.member.id,
    customerId: account.member.customerId,
    name: formatMemberName(account.member),
    email: account.member.email,
    levelName: level?.name ?? "无等级",
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
  const level = getDisplayLevel(member, levels, lifetimeEarned);
  const nextLevel =
    member.status === MEMBER_STATUS.ACTIVE
      ? getNextLevelForPoints(levels, lifetimeEarned)
      : null;
  const latestLedger = member.pointsLedgers?.[0];

  return {
    id: member.id,
    customerId: member.customerId,
    name: formatMemberName(member),
    email: member.email,
    status: member.status,
    joinedAt: member.joinedAt?.toISOString() ?? null,
    levelName: level?.name ?? "无等级",
    levelThresholdPoints: level?.thresholdPoints ?? 0,
    nextLevelName: nextLevel?.name ?? null,
    isHighestLevel: member.status === MEMBER_STATUS.ACTIVE && !nextLevel,
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
        timelineEvents: {
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
  const level = getDisplayLevel(member, levels, lifetimeEarned);
  const nextLevel =
    member.status === MEMBER_STATUS.ACTIVE
      ? getNextLevelForPoints(levels, lifetimeEarned)
      : null;
  const currentThreshold = level?.thresholdPoints ?? 0;
  const nextThreshold = nextLevel?.thresholdPoints ?? currentThreshold;
  const levelRange = Math.max(1, nextThreshold - currentThreshold);
  const levelProgressPoints = Math.max(0, lifetimeEarned - currentThreshold);
  const levelProgressPercent = nextLevel
    ? Math.min(100, Math.floor((levelProgressPoints / levelRange) * 100))
    : 100;
  const hydratedLedgers = await hydrateLedgerOrderNames(shop, member.pointsLedgers);

  return {
    member: {
      id: member.id,
      customerId: member.customerId,
      name: formatMemberName(member),
      email: member.email,
      status: member.status,
      joinedAt: member.joinedAt?.toISOString() ?? null,
      levelName: level?.name ?? "无等级",
      nextLevelName: nextLevel?.name ?? null,
      pointsToNextLevel: nextLevel
        ? Math.max(0, nextLevel.thresholdPoints - lifetimeEarned)
        : 0,
      levelProgressPercent,
      balance: account?.balance ?? 0,
      lifetimeEarned,
      lifetimeSpent: account?.lifetimeSpent ?? 0,
      updatedAt: member.updatedAt.toISOString(),
    },
    ledgers: hydratedLedgers,
    timelineEvents: member.timelineEvents.map(serializeTimelineEvent),
  };
}

export async function updateMemberStatus({ shop, memberId, status, actor }) {
  if (!Object.values(MEMBER_STATUS).includes(status)) {
    throw new Error("无效的会员状态。");
  }

  const [levels, member] = await Promise.all([
    getOrCreateDefaultLevelConfigs(shop),
    db.member.findFirst({
      where: {
        id: memberId,
        shop,
      },
      include: {
        pointsAccount: true,
      },
    }),
  ]);

  if (!member) {
    throw new Error("会员不存在。");
  }

  const lifetimeEarned = member.pointsAccount?.lifetimeEarned ?? 0;
  const currentLevel =
    status === MEMBER_STATUS.ACTIVE
      ? getLevelForPoints(levels, lifetimeEarned)
      : null;

  return db.$transaction(async (tx) => {
    const updatedMember = await tx.member.update({
      where: { id: memberId },
      data: {
        status,
        currentLevelId: currentLevel?.id ?? null,
        joinedAt:
          status === MEMBER_STATUS.ACTIVE && !member.joinedAt
            ? new Date()
            : member.joinedAt,
      },
    });

    await tx.memberTimelineEvent.create({
      data: {
        shop,
        memberId,
        type: "STATUS_CHANGE",
        title: `将会员状态改为 ${status}`,
        content: `原状态：${member.status}`,
        actorName: actor?.actorName || "Merchant",
        actorEmail: actor?.actorEmail || null,
        actorUserId: actor?.actorUserId || null,
        metadataJson: JSON.stringify({
          from: member.status,
          to: status,
        }),
      },
    });

    return updatedMember;
  });
}
