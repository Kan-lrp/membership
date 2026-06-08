import { useEffect } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  adjustMemberPoints,
  getMemberDetailData,
} from "../models/points.server";

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);

  // params.memberId 来自文件名里的 $memberId。
  // 例如 /app/members/abc123 会把 abc123 放到 params.memberId。
  return getMemberDetailData(session.shop, params.memberId);
};

export const action = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  try {
    await adjustMemberPoints({
      shop: session.shop,
      memberId: params.memberId,
      points: formData.get("points"),
      reason: formData.get("reason"),
    });

    return { ok: true };
  } catch (error) {
    // 表单错误直接返回给当前页面展示，不让整个页面崩掉。
    return { ok: false, error: error.message };
  }
};

function formatDate(value) {
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

export default function MemberDetailPage() {
  const { member, ledgers } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const isSaving = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.ok) {
      shopify.toast.show("积分调整已保存");
    }

    if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error);
    }
  }, [fetcher.data, shopify]);

  return (
    <s-page heading={member.name}>
      <s-link slot="breadcrumb-actions" href="/app/members">
        会员列表
      </s-link>

      <s-section heading="会员信息">
        <s-grid gridTemplateColumns="repeat(4, 1fr)" gap="base">
          {renderMetricBox("当前等级", member.levelName)}
          {renderMetricBox("积分余额", member.balance)}
          {renderMetricBox("累计获得", member.lifetimeEarned)}
          {renderMetricBox("累计消耗", member.lifetimeSpent)}
        </s-grid>
      </s-section>

      <s-section heading="手动调整积分">
        {/* 手动调分也必须写积分流水，不能直接改余额。 */}
        <fetcher.Form method="post">
          <s-stack direction="block" gap="base">
            {fetcher.data?.error && (
              <s-banner tone="critical">{fetcher.data.error}</s-banner>
            )}
            <s-grid gridTemplateColumns="1fr 2fr auto" gap="base">
              <s-number-field
                label="调整积分"
                name="points"
                placeholder="例如 100 或 -50"
                step={1}
                required
              ></s-number-field>
              <s-text-field
                label="调整原因"
                name="reason"
                placeholder="例如 客服补偿、异常扣回"
              ></s-text-field>
              <s-stack alignItems="end">
                <s-button
                  type="submit"
                  variant="primary"
                  {...(isSaving ? { loading: true } : {})}
                >
                  保存调整
                </s-button>
              </s-stack>
            </s-grid>
          </s-stack>
        </fetcher.Form>
      </s-section>

      <s-section heading="积分流水">
        {ledgers.length > 0 ? (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">类型</s-table-header>
              <s-table-header>变动积分</s-table-header>
              <s-table-header>变动后余额</s-table-header>
              <s-table-header>原因</s-table-header>
              <s-table-header>来源</s-table-header>
              <s-table-header>时间</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {ledgers.map((ledger) => (
                <s-table-row key={ledger.id}>
                  <s-table-cell>{ledger.type}</s-table-cell>
                  <s-table-cell>{formatPoints(ledger.points)}</s-table-cell>
                  <s-table-cell>{ledger.balanceAfter}</s-table-cell>
                  <s-table-cell>{ledger.reason || "-"}</s-table-cell>
                  <s-table-cell>{ledger.sourceType}</s-table-cell>
                  <s-table-cell>{formatDate(ledger.createdAt)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        ) : (
          <s-paragraph color="subdued">这个会员还没有积分流水。</s-paragraph>
        )}
      </s-section>

      <s-section slot="aside" heading="基础资料">
        <s-paragraph>
          <s-text>邮箱：</s-text>
          <s-text>{member.email || "-"}</s-text>
        </s-paragraph>
        <s-paragraph>
          <s-text>Customer ID：</s-text>
          <s-text>{member.customerId}</s-text>
        </s-paragraph>
        <s-paragraph>
          <s-text>最近更新：</s-text>
          <s-text>{formatDate(member.updatedAt)}</s-text>
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
