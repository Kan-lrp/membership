import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getWebhookLogsData } from "../models/points.server";

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

export default function LogsPage() {
  const { events } = useLoaderData();

  return (
    <s-page heading="日志">
      <s-section heading="Webhook 事件">
        <s-banner tone="info">
          如果订单没有加积分、取消订单没有扣积分，先看这里是否收到对应
          webhook，以及状态是 PROCESSED、SKIPPED 还是 FAILED。
        </s-banner>

        {events.length > 0 ? (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Topic</s-table-header>
              <s-table-header>状态</s-table-header>
              <s-table-header>资源 ID</s-table-header>
              <s-table-header>尝试次数</s-table-header>
              <s-table-header>错误/跳过原因</s-table-header>
              <s-table-header>收到时间</s-table-header>
              <s-table-header>处理时间</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {events.map((event) => (
                <s-table-row key={event.id}>
                  <s-table-cell>{event.topic}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={getStatusTone(event.status)}>
                      {event.status}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>{event.resourceId}</s-table-cell>
                  <s-table-cell>{event.attempts}</s-table-cell>
                  <s-table-cell>{event.error || "-"}</s-table-cell>
                  <s-table-cell>{formatDate(event.receivedAt)}</s-table-cell>
                  <s-table-cell>{formatDate(event.processedAt)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
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
