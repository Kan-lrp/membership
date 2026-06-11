import db from "../db.server";

// 这个文件负责“会员详情页的人工作业时间线”。
// 主要负责：
// 1. 获取当前 Shopify 后台操作人的名称/邮箱
// 2. 创建商家手动备注
// 3. 给手动操作记录操作者信息
// 注意：系统自动事件，比如订单付款、退款、取消，不写进时间线。
// 这些系统事件已经在积分流水和 webhook 日志里记录。

export function getActorFromSession(session) {
  const name = [session.firstName, session.lastName].filter(Boolean).join(" ");

  return {
    actorName: name || session.email || "Merchant",
    actorEmail: session.email || null,
    actorUserId: session.userId ? String(session.userId) : null,
  };
}

export async function createMemberTimelineNote({ shop, memberId, content, actor }) {
  const normalizedContent = String(content ?? "").trim();

  if (!normalizedContent) {
    throw new Error("请填写备注内容。");
  }

  const member = await db.member.findFirst({
    where: {
      id: memberId,
      shop,
    },
  });

  if (!member) {
    throw new Error("会员不存在。");
  }

  return db.memberTimelineEvent.create({
    data: {
      shop,
      memberId,
      type: "NOTE",
      title: "添加备注",
      content: normalizedContent,
      actorName: actor?.actorName || "Merchant",
      actorEmail: actor?.actorEmail || null,
      actorUserId: actor?.actorUserId || null,
    },
  });
}
