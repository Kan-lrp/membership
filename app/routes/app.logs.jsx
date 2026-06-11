import { useEffect, useMemo, useState } from "react";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getWebhookLogsData } from "../services/webhooks.server";

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 20, 30];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  // 日志按店铺隔离，只看当前店铺的 webhook 事件。
  return getWebhookLogsData(session.shop);
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

function getStatusTone(status) {
  if (status === "PROCESSED") {
    return "success";
  }

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

export default function LogsPage() {
  const { events } = useLoaderData();
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredEvents = useMemo(() => {
    if (!normalizedQuery) {
      return events;
    }

    return events.filter((event) => {
      const searchableText = [
        event.topic,
        event.status,
        event.resourceName,
        event.error,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchableText.includes(normalizedQuery);
    });
  }, [events, normalizedQuery]);
  const pageCount = Math.max(1, Math.ceil(filteredEvents.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedEvents = filteredEvents.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  useEffect(() => {
    setPage(1);
  }, [query, pageSize]);

  return (
    <s-page heading="日志">
      <s-section heading="Webhook 事件">
        <s-banner tone="info">
          如果订单没有加积分、取消订单没有扣积分，先看这里是否收到对应
          webhook，以及状态是 PROCESSED、SKIPPED 还是 FAILED。
        </s-banner>

        {events.length > 0 ? (
          <s-stack direction="block" gap="base">
            <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="end">
              <s-search-field
                label="搜索日志"
                labelAccessibilityVisibility="exclusive"
                placeholder="搜索 topic、状态、订单号、错误原因"
                value={query}
                onInput={(event) => setQuery(event.currentTarget.value)}
              ></s-search-field>
              <s-select
                label="每页显示"
                value={String(pageSize)}
                onChange={(event) => setPageSize(Number(event.currentTarget.value))}
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <s-option key={size} value={String(size)}>
                    {size} 条
                  </s-option>
                ))}
              </s-select>
            </s-grid>

            {pagedEvents.length > 0 ? (
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
                  {pagedEvents.map((event) => (
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
              <s-paragraph color="subdued">没有匹配的日志。</s-paragraph>
            )}

            {filteredEvents.length > pageSize && (
              <s-stack
                direction="inline"
                gap="base"
                justifyContent="end"
                alignItems="center"
              >
                <s-button
                  disabled={currentPage <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  上一页
                </s-button>
                <s-text color="subdued">
                  第 {currentPage} / {pageCount} 页
                </s-text>
                <s-button
                  disabled={currentPage >= pageCount}
                  onClick={() =>
                    setPage((current) => Math.min(pageCount, current + 1))
                  }
                >
                  下一页
                </s-button>
              </s-stack>
            )}
          </s-stack>
        ) : (
          <s-paragraph color="subdued">
            暂无 webhook 事件。订单支付或取消后，这里会出现处理记录。
          </s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
