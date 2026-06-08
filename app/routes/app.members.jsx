import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getMembersData } from "../models/points.server";

export const loader = async ({ request }) => {
  // 会员列表属于商家后台页面，所以必须先确认当前请求来自 Shopify Admin。
  const { session } = await authenticate.admin(request);

  // 按当前店铺读取会员列表，避免不同店铺之间数据串在一起。
  return getMembersData(session.shop);
};

function formatDate(value) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatPoints(points) {
  return `${points > 0 ? "+" : ""}${points}`;
}

function renderMetricBox(label, value) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack direction="block" gap="small">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value}</s-heading>
      </s-stack>
    </s-box>
  );
}

function renderMemberFact(label, value) {
  return (
    <s-box padding="small" background="subdued" borderRadius="base">
      <s-stack direction="block" gap="small">
        <s-text color="subdued">{label}</s-text>
        <s-text>{value}</s-text>
      </s-stack>
    </s-box>
  );
}

export default function MembersPage() {
  // loader 返回的数据会在这里拿到。
  const { members } = useLoaderData();
  const totalBalance = members.reduce((sum, member) => sum + member.balance, 0);
  const totalLifetimeEarned = members.reduce(
    (sum, member) => sum + member.lifetimeEarned,
    0,
  );
  const highestLevelMembers = members.filter(
    (member) => !member.nextLevelName,
  ).length;

  return (
    <s-page heading="会员列表">
      <s-section heading="会员概览">
        {/* 这里是列表页自己的汇总，方便商家不进入首页也能快速看会员规模。 */}
        <s-grid gridTemplateColumns="repeat(4, 1fr)" gap="base">
          {renderMetricBox("会员数", members.length)}
          {renderMetricBox("总积分余额", totalBalance)}
          {renderMetricBox("累计发放积分", totalLifetimeEarned)}
          {renderMetricBox("最高等级会员", highestLevelMembers)}
        </s-grid>
      </s-section>

      <s-section heading="全部会员">
        {/* 列太多时表格会被挤压，所以这里改成卡片式布局，读起来更像后台详情摘要。 */}
        {members.length > 0 ? (
          <s-stack direction="block" gap="base">
            {members.map((member) => (
              <s-box
                key={member.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack direction="block" gap="base">
                  <s-stack
                    direction="inline"
                    justifyContent="space-between"
                    alignItems="center"
                  >
                    <s-stack direction="block" gap="small">
                      {/* 点击会员姓名进入详情页。 */}
                      <s-link href={`/app/members/${member.id}`}>
                        {member.name}
                      </s-link>
                      <s-text color="subdued">{member.email || "-"}</s-text>
                    </s-stack>
                    <s-stack direction="inline" gap="base" alignItems="center">
                      <s-badge tone="info">{member.levelName}</s-badge>
                      <s-link href={`/app/members/${member.id}`}>查看详情</s-link>
                    </s-stack>
                  </s-stack>

                  <s-grid gridTemplateColumns="repeat(3, 1fr)" gap="base">
                    {renderMemberFact("积分余额", member.balance)}
                    {renderMemberFact("累计获得", member.lifetimeEarned)}
                    {renderMemberFact("累计消耗", member.lifetimeSpent)}
                    {renderMemberFact(
                      "升级进度",
                      member.nextLevelName
                        ? `距 ${member.nextLevelName} 还差 ${member.pointsToNextLevel} 分`
                        : "已是最高等级",
                    )}
                    {renderMemberFact("流水数量", `${member.ledgerCount} 条`)}
                    {renderMemberFact(
                      "最近变动",
                      member.latestLedger
                        ? `${member.latestLedger.type} ${formatPoints(
                            member.latestLedger.points,
                          )}`
                        : "-",
                    )}
                  </s-grid>

                  <s-grid gridTemplateColumns="2fr 1fr 1fr" gap="base">
                    {renderMemberFact("Customer ID", member.customerId)}
                    {renderMemberFact("创建时间", formatDate(member.createdAt))}
                    {renderMemberFact("最近更新", formatDate(member.updatedAt))}
                  </s-grid>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        ) : (
          <s-paragraph color="subdued">
            还没有会员。产生一笔带客户的已支付订单后，会员会自动出现在这里。
          </s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
