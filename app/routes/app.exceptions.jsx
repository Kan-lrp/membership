import { useEffect, useMemo, useState } from "react";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getExceptionData } from "../services/webhooks.server";

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 20, 30];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const navigationParams = new URLSearchParams(url.search);

  if (!navigationParams.get("shop")) {
    navigationParams.set("shop", session.shop);
  }

  return {
    ...(await getExceptionData(session.shop)),
    navigationSearch: `?${navigationParams.toString()}`,
  };
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

function getStatusTone(status) {
  if (status === "FAILED") {
    return "critical";
  }

  if (status === "SKIPPED") {
    return "warning";
  }

  return "info";
}

function getOrderIdFromResourceId(resourceId) {
  if (!resourceId) {
    return null;
  }

  if (resourceId.includes(":gid://shopify/Refund/")) {
    return resourceId.split(":gid://shopify/Refund/")[0];
  }

  if (resourceId.startsWith("gid://shopify/Order/")) {
    return resourceId;
  }

  return null;
}

function getOrderAdminPath(orderId) {
  const orderNumericId = orderId?.split("/").pop();

  return orderNumericId ? `shopify://admin/orders/${orderNumericId}` : null;
}

function renderOrderButton(event) {
  const orderId = getOrderIdFromResourceId(event.resourceId);

  if (!event.resourceName || !orderId) {
    return "-";
  }

  return (
    <button
      type="button"
      onClick={() => {
        const orderAdminPath = getOrderAdminPath(orderId);

        if (orderAdminPath) {
          window.open(orderAdminPath, "_top");
        }
      }}
      style={{
        padding: 0,
        border: 0,
        background: "transparent",
        color: "#005bd3",
        cursor: "pointer",
        font: "inherit",
      }}
      aria-label={`打开订单 ${event.resourceName}`}
    >
      {event.resourceName}
    </button>
  );
}

export default function ExceptionsPage() {
  const { negativeMembers, webhookIssues, navigationSearch } = useLoaderData();
  const [negativeQuery, setNegativeQuery] = useState("");
  const [negativePageSize, setNegativePageSize] = useState(DEFAULT_PAGE_SIZE);
  const [negativePage, setNegativePage] = useState(1);
  const [webhookQuery, setWebhookQuery] = useState("");
  const [webhookPageSize, setWebhookPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [webhookPage, setWebhookPage] = useState(1);
  const filteredNegativeMembers = useMemo(() => {
    const query = negativeQuery.trim().toLowerCase();

    if (!query) {
      return negativeMembers;
    }

    return negativeMembers.filter((member) => {
      const searchableText = [
        member.name,
        member.email,
        member.levelName,
        member.latestLedger?.type,
        member.latestLedger?.reason,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchableText.includes(query);
    });
  }, [negativeMembers, negativeQuery]);
  const filteredWebhookIssues = useMemo(() => {
    const query = webhookQuery.trim().toLowerCase();

    if (!query) {
      return webhookIssues;
    }

    return webhookIssues.filter((event) => {
      const searchableText = [
        event.topic,
        event.status,
        event.resourceName,
        event.error,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchableText.includes(query);
    });
  }, [webhookIssues, webhookQuery]);
  const negativePageCount = Math.max(
    1,
    Math.ceil(filteredNegativeMembers.length / negativePageSize),
  );
  const currentNegativePage = Math.min(negativePage, negativePageCount);
  const pagedNegativeMembers = filteredNegativeMembers.slice(
    (currentNegativePage - 1) * negativePageSize,
    currentNegativePage * negativePageSize,
  );
  const webhookPageCount = Math.max(
    1,
    Math.ceil(filteredWebhookIssues.length / webhookPageSize),
  );
  const currentWebhookPage = Math.min(webhookPage, webhookPageCount);
  const pagedWebhookIssues = filteredWebhookIssues.slice(
    (currentWebhookPage - 1) * webhookPageSize,
    currentWebhookPage * webhookPageSize,
  );

  useEffect(() => {
    setNegativePage(1);
  }, [negativeQuery, negativePageSize]);

  useEffect(() => {
    setWebhookPage(1);
  }, [webhookQuery, webhookPageSize]);

  return (
    <s-page heading="异常处理">
      <s-section heading="负积分会员">
        <s-banner tone="warning">
          负积分通常表示会员已经使用过积分，但后来订单取消或退款导致积分被扣回。
          这类会员需要商家人工确认，必要时进入详情页手动调分。
        </s-banner>

        {negativeMembers.length > 0 ? (
          <s-stack direction="block" gap="base">
            <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="end">
              <s-search-field
                label="搜索负积分会员"
                labelAccessibilityVisibility="exclusive"
                placeholder="搜索会员、邮箱、等级、最近流水"
                value={negativeQuery}
                onInput={(event) => setNegativeQuery(event.currentTarget.value)}
              ></s-search-field>
              <s-select
                label="每页显示"
                value={String(negativePageSize)}
                onChange={(event) =>
                  setNegativePageSize(Number(event.currentTarget.value))
                }
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <s-option key={size} value={String(size)}>
                    {size} 条
                  </s-option>
                ))}
              </s-select>
            </s-grid>

            {pagedNegativeMembers.length > 0 ? (
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">会员</s-table-header>
                  <s-table-header>邮箱</s-table-header>
                  <s-table-header>等级</s-table-header>
                  <s-table-header>当前余额</s-table-header>
                  <s-table-header>最近流水</s-table-header>
                  <s-table-header>操作</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {pagedNegativeMembers.map((member) => (
                    <s-table-row key={member.id}>
                      <s-table-cell>{member.name}</s-table-cell>
                      <s-table-cell>{member.email || "-"}</s-table-cell>
                      <s-table-cell>{member.levelName}</s-table-cell>
                      <s-table-cell>{member.balance}</s-table-cell>
                      <s-table-cell>
                        {member.latestLedger
                          ? `${member.latestLedger.type} ${formatPoints(
                              member.latestLedger.points,
                            )}`
                          : "-"}
                      </s-table-cell>
                      <s-table-cell>
                        <s-link href={`/app/members/${member.id}${navigationSearch}`}>
                          进入详情处理
                        </s-link>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            ) : (
              <s-paragraph color="subdued">没有匹配的负积分会员。</s-paragraph>
            )}

            {filteredNegativeMembers.length > negativePageSize && (
              <s-stack
                direction="inline"
                gap="base"
                justifyContent="end"
                alignItems="center"
              >
                <s-button
                  disabled={currentNegativePage <= 1}
                  onClick={() =>
                    setNegativePage((current) => Math.max(1, current - 1))
                  }
                >
                  上一页
                </s-button>
                <s-text color="subdued">
                  第 {currentNegativePage} / {negativePageCount} 页
                </s-text>
                <s-button
                  disabled={currentNegativePage >= negativePageCount}
                  onClick={() =>
                    setNegativePage((current) =>
                      Math.min(negativePageCount, current + 1),
                    )
                  }
                >
                  下一页
                </s-button>
              </s-stack>
            )}
          </s-stack>
        ) : (
          <s-paragraph color="subdued">当前没有负积分会员。</s-paragraph>
        )}
      </s-section>

      <s-section heading="Webhook 异常">
        <s-banner tone="info">
          这里集中展示 FAILED 和 SKIPPED 的 webhook。订单没有加分、取消或退款没有扣回时，
          可以先看这里的错误原因。
        </s-banner>

        {webhookIssues.length > 0 ? (
          <s-stack direction="block" gap="base">
            <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="end">
              <s-search-field
                label="搜索 webhook 异常"
                labelAccessibilityVisibility="exclusive"
                placeholder="搜索 topic、状态、订单号、错误原因"
                value={webhookQuery}
                onInput={(event) => setWebhookQuery(event.currentTarget.value)}
              ></s-search-field>
              <s-select
                label="每页显示"
                value={String(webhookPageSize)}
                onChange={(event) =>
                  setWebhookPageSize(Number(event.currentTarget.value))
                }
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <s-option key={size} value={String(size)}>
                    {size} 条
                  </s-option>
                ))}
              </s-select>
            </s-grid>

            {pagedWebhookIssues.length > 0 ? (
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Topic</s-table-header>
                  <s-table-header>状态</s-table-header>
                  <s-table-header>订单号</s-table-header>
                  <s-table-header>尝试次数</s-table-header>
                  <s-table-header>错误/跳过原因</s-table-header>
                  <s-table-header>收到时间</s-table-header>
                  <s-table-header>处理时间</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {pagedWebhookIssues.map((event) => (
                    <s-table-row key={event.id}>
                      <s-table-cell>{event.topic}</s-table-cell>
                      <s-table-cell>
                        <s-badge tone={getStatusTone(event.status)}>
                          {event.status}
                        </s-badge>
                      </s-table-cell>
                      {/* resourceName 是订单号，例如 #1001。历史旧日志没有订单号时显示 -。 */}
                      <s-table-cell>{renderOrderButton(event)}</s-table-cell>
                      <s-table-cell>{event.attempts}</s-table-cell>
                      <s-table-cell>{event.error || "-"}</s-table-cell>
                      <s-table-cell>{formatDate(event.receivedAt)}</s-table-cell>
                      <s-table-cell>{formatDate(event.processedAt)}</s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            ) : (
              <s-paragraph color="subdued">没有匹配的 webhook 异常。</s-paragraph>
            )}

            {filteredWebhookIssues.length > webhookPageSize && (
              <s-stack
                direction="inline"
                gap="base"
                justifyContent="end"
                alignItems="center"
              >
                <s-button
                  disabled={currentWebhookPage <= 1}
                  onClick={() =>
                    setWebhookPage((current) => Math.max(1, current - 1))
                  }
                >
                  上一页
                </s-button>
                <s-text color="subdued">
                  第 {currentWebhookPage} / {webhookPageCount} 页
                </s-text>
                <s-button
                  disabled={currentWebhookPage >= webhookPageCount}
                  onClick={() =>
                    setWebhookPage((current) =>
                      Math.min(webhookPageCount, current + 1),
                    )
                  }
                >
                  下一页
                </s-button>
              </s-stack>
            )}
          </s-stack>
        ) : (
          <s-paragraph color="subdued">
            当前没有 FAILED 或 SKIPPED 的 webhook 事件。
          </s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
