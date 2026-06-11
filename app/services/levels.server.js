import db from "../db.server";
import { DEFAULT_LEVELS, MEMBER_STATUS } from "./constants.server";

// 这个文件负责“会员等级规则”。
// 主要负责：
// 1. 初始化默认等级
// 2. 根据累计积分计算会员等级
// 3. 保存商家配置的等级名称和积分门槛
// 4. 保存等级规则后，重新计算已开通会员的等级
// 注意：这里只处理等级规则，不处理积分流水入账。

export function serializeLevel(level) {
  // 等级配置给前端展示时，只需要名称、门槛和排序。
  return {
    id: level.id,
    name: level.name,
    thresholdPoints: level.thresholdPoints,
    sortOrder: level.sortOrder,
  };
}

export function getLevelForPoints(levels, lifetimeEarned) {
  // 从低到高找，最后一个满足 thresholdPoints <= 累计积分的等级就是当前等级。
  // 例如累计 600 分，会依次命中普通、银卡、金卡，最终返回金卡。
  return levels.reduce((matchedLevel, level) => {
    if (lifetimeEarned >= level.thresholdPoints) {
      return level;
    }

    return matchedLevel;
  }, levels[0]);
}

export function getNextLevelForPoints(levels, lifetimeEarned) {
  // 找到第一个门槛高于当前累计积分的等级，就是“下一等级”。
  // 如果找不到，说明已经是最高等级。
  return levels.find((level) => lifetimeEarned < level.thresholdPoints) ?? null;
}

export function getDisplayLevel(member, levels, lifetimeEarned) {
  // 非 ACTIVE 会员还没正式加入会员权益体系，所以列表和详情里不展示金卡/银卡。
  // 这样历史积分不会让“待开通会员”看起来像已经拥有等级权益。
  if (member.status !== MEMBER_STATUS.ACTIVE) {
    return null;
  }

  return member.currentLevel ?? getLevelForPoints(levels, lifetimeEarned);
}

export async function getOrCreateDefaultLevelConfigs(shop, client = db) {
  // MVP 默认四档等级只应该在店铺第一次没有等级配置时创建。
  // 注意：这里不能每次读取都 update 默认值，否则商家在后台改了“银卡=88分”，
  // 下一次刷新页面又会被 DEFAULT_LEVELS 覆盖回“银卡=100分”。
  const existingLevels = await client.levelConfig.findMany({
    where: { shop },
  });

  if (existingLevels.length === 0) {
    await Promise.all(
      DEFAULT_LEVELS.map((level) =>
        client.levelConfig.create({
          data: {
            shop,
            ...level,
          },
        }),
      ),
    );
  }

  return client.levelConfig.findMany({
    where: { shop },
    orderBy: { thresholdPoints: "asc" },
  });
}

export async function updateLevelConfigs(shop, rawLevels) {
  // 保存等级配置。MVP 只编辑已有等级，不新增/删除。
  // rawLevels 来自前端表单，所以这里必须做后端校验。
  const normalizedLevels = rawLevels.map((level) => ({
    id: String(level.id ?? ""),
    name: String(level.name ?? "").trim(),
    thresholdPoints: Number.parseInt(level.thresholdPoints, 10),
  }));

  if (normalizedLevels.some((level) => !level.id)) {
    throw new Error("等级配置缺少 id。");
  }

  if (normalizedLevels.some((level) => !level.name)) {
    throw new Error("等级名称不能为空。");
  }

  if (
    normalizedLevels.some(
      (level) =>
        !Number.isFinite(level.thresholdPoints) || level.thresholdPoints < 0,
    )
  ) {
    throw new Error("等级门槛必须是非负整数。");
  }

  const thresholdSet = new Set(
    normalizedLevels.map((level) => level.thresholdPoints),
  );

  if (thresholdSet.size !== normalizedLevels.length) {
    throw new Error("等级门槛不能重复。");
  }

  if (!thresholdSet.has(0)) {
    throw new Error("必须保留一个 0 积分门槛的最低等级。");
  }

  const sortedLevels = [...normalizedLevels].sort(
    (a, b) => a.thresholdPoints - b.thresholdPoints,
  );

  return db.$transaction(async (tx) => {
    const existingLevels = await tx.levelConfig.findMany({
      where: { shop },
    });
    const existingIds = new Set(existingLevels.map((level) => level.id));

    for (const level of sortedLevels) {
      if (!existingIds.has(level.id)) {
        throw new Error("不能修改不属于当前店铺的等级。");
      }
    }

    // 两阶段更新：
    // 第一步先把 name 和 thresholdPoints 临时改成不会冲突的值。
    // 这样商家交换两个等级门槛或名称时，不会因为数据库唯一约束临时撞车。
    for (const [index, level] of sortedLevels.entries()) {
      await tx.levelConfig.update({
        where: { id: level.id },
        data: {
          name: `__updating_${level.id}`,
          thresholdPoints: -1 - index,
          sortOrder: index + 1,
        },
      });
    }

    for (const [index, level] of sortedLevels.entries()) {
      await tx.levelConfig.update({
        where: { id: level.id },
        data: {
          name: level.name,
          thresholdPoints: level.thresholdPoints,
          sortOrder: index + 1,
        },
      });
    }

    const savedLevels = await tx.levelConfig.findMany({
      where: { shop },
      orderBy: { thresholdPoints: "asc" },
    });
    const activeMembers = await tx.member.findMany({
      where: {
        shop,
        status: MEMBER_STATUS.ACTIVE,
      },
      include: {
        pointsAccount: true,
      },
    });

    for (const member of activeMembers) {
      const lifetimeEarned = member.pointsAccount?.lifetimeEarned ?? 0;
      const level = getLevelForPoints(savedLevels, lifetimeEarned);

      await tx.member.update({
        where: { id: member.id },
        data: {
          currentLevelId: level?.id ?? null,
        },
      });
    }

    return savedLevels.map(serializeLevel);
  });
}
