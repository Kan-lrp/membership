import { useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getMemberDetailData, updateMemberStatus } from "../services/members.server";
import { adjustMemberPoints } from "../services/points.server";
import {
  createMemberTimelineNote,
  getActorFromSession,
} from "../services/timeline.server";

const DEFAULT_LEDGER_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 20, 30];

// 注意文件名里的 app.members_.$memberId.jsx：
// 下划线 _ 是 React Router flat routes 的写法，用来避免这个详情页变成 app.members.jsx 的子路由。
// 如果文件名写成 app.members.$memberId.jsx，而列表页又没有 <Outlet />，就会一直显示会员列表，看不到详情页。
export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const navigationParams = new URLSearchParams(url.search);

  // 详情页也补一次 shop 参数，这样返回列表或提交表单后都能保持在当前店铺上下文。
  if (!navigationParams.get("shop")) {
    navigationParams.set("shop", session.shop);
  }

  // params.memberId 来自文件名里的 $memberId。
  // 例如 /app/members/abc123 会把 abc123 放到 params.memberId。
  return {
    ...(await getMemberDetailData(session.shop, params.memberId)),
    navigationSearch: `?${navigationParams.toString()}`,
  };
};

export const action = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  // 读取手动调分表单提交上来的 points 和 reason。
  const formData = await request.formData();
  const intent = formData.get("intent");
  const actor = getActorFromSession(session);

  try {
    if (intent === "updateStatus") {
      await updateMemberStatus({
        shop: session.shop,
        memberId: params.memberId,
        status: formData.get("status"),
        actor,
      });

      return { ok: true, message: "会员状态已更新" };
    }

    if (intent === "createNote") {
      await createMemberTimelineNote({
        shop: session.shop,
        memberId: params.memberId,
        content: formData.get("content"),
        actor,
      });

      return { ok: true, message: "备注已发布" };
    }

    await adjustMemberPoints({
      shop: session.shop,
      memberId: params.memberId,
      points: formData.get("points"),
      reason: formData.get("reason"),
      actor,
    });

    return { ok: true, message: "积分调整已保存" };
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

function getLedgerTypeTone(type) {
  // 和首页流水保持一致：同一个流水类型固定同一个 badge 色调。
  if (type === "EARN") {
    return "success";
  }

  if (type === "REFUND" || type === "CANCEL") {
    return "warning";
  }

  if (type === "ADJUST") {
    return "info";
  }

  return "neutral";
}

function getOrderIdFromLedger(ledger) {
  if (ledger.orderId) {
    return ledger.orderId;
  }

  // EARN / CANCEL 的 sourceId 本身就是订单 gid。
  // REFUND 的 sourceId 是 orderId + refundId 拼出来的，所以要取前半段订单 gid。
  if (!ledger.orderName || !ledger.sourceId) {
    return null;
  }

  const refundSeparator = ":gid://shopify/Refund/";

  if (ledger.sourceId.includes(refundSeparator)) {
    return ledger.sourceId.split(refundSeparator)[0];
  }

  if (ledger.sourceId.startsWith("gid://shopify/Order/")) {
    return ledger.sourceId;
  }

  return null;
}

function getOrderAdminPath(orderId) {
  const orderNumericId = orderId?.split("/").pop();

  return orderNumericId ? `shopify://admin/orders/${orderNumericId}` : null;
}

function renderOrderButton(ledger, onOpenOrder) {
  const orderId = getOrderIdFromLedger(ledger);

  if (!orderId) {
    return "-";
  }

  return (
    <button
      type="button"
      onClick={() => onOpenOrder(ledger)}
      style={{
        padding: 0,
        border: 0,
        background: "transparent",
        color: "#005bd3",
        cursor: "pointer",
        font: "inherit",
        textDecoration: "none",
      }}
      aria-label={`打开订单 ${ledger.orderName}`}
    >
      {ledger.orderName}
    </button>
  );
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

function getStatusLabel(status) {
  if (status === "ACTIVE") {
    return "已开通";
  }

  if (status === "INACTIVE") {
    return "已停用";
  }

  return "待开通";
}

function getStatusTone(status) {
  if (status === "ACTIVE") {
    return "success";
  }

  if (status === "INACTIVE") {
    return "critical";
  }

  return "warning";
}

function isMemberStatusValue(value) {
  // 时间线展开内容里如果是 ACTIVE / INACTIVE / PENDING，
  // 就用 badge 显示，让状态值比普通文字更醒目。
  return ["ACTIVE", "INACTIVE", "PENDING"].includes(value);
}

function renderStatusForm(formFetcher, status, label, options = {}) {
  return (
    <formFetcher.Form method="post">
      <input type="hidden" name="intent" value="updateStatus" />
      <input type="hidden" name="status" value={status} />
      <s-button
        type="submit"
        variant={options.variant || "secondary"}
        tone={options.tone}
        {...(options.loading ? { loading: true } : {})}
      >
        {label}
      </s-button>
    </formFetcher.Form>
  );
}

function getTimelineContentLabel(type) {
  // 不同人工事件的详情字段名不同：
  // 备注显示“备注”，手动调分显示“原因”，其他默认显示“内容”。
  if (type === "NOTE") {
    return "备注";
  }

  if (type === "MANUAL_ADJUST") {
    return "原因";
  }

  return "内容";
}

function getTimelineContentParts(event) {
  // 状态变更的 content 存的是“原状态：ACTIVE”这种字符串。
  // 页面展示时拆成两行：第一行“原状态：”，第二行显示 ACTIVE badge。
  if (event.type === "STATUS_CHANGE" && event.content?.startsWith("原状态：")) {
    return {
      label: "原状态",
      value: event.content.replace("原状态：", ""),
    };
  }

  return {
    label: getTimelineContentLabel(event.type),
    value: event.content,
  };
}

function getTimelineTitleParts(event) {
  // 备注事件在标题上直接露出一小段内容，方便不用展开也能大概知道写了什么。
  // 最多展示 10 个字，超过就加省略号；完整内容展开后再看。
  if (event.type === "NOTE" && event.content) {
    const summary =
      event.content.length > 10
        ? `${event.content.slice(0, 10)}...`
        : event.content;

    return {
      title: event.title,
      summary,
    };
  }

  return {
    title: event.title,
    summary: null,
  };
}

export default function MemberDetailPage() {
  const { member, ledgers, timelineEvents, navigationSearch } = useLoaderData();
  // fetcher.Form 提交 action 时不会离开当前详情页，适合做这种后台表单。
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const isSaving = fetcher.state !== "idle";
  const [ledgerQuery, setLedgerQuery] = useState("");
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerPageSize, setLedgerPageSize] = useState(DEFAULT_LEDGER_PAGE_SIZE);
  // openTimelineIds 保存当前哪些时间线事件处于展开状态。
  // 点箭头时会把事件 id 加进去或移除。
  const [openTimelineIds, setOpenTimelineIds] = useState([]);
  const normalizedLedgerQuery = ledgerQuery.trim().toLowerCase();
  const filteredLedgers = useMemo(() => {
    if (!normalizedLedgerQuery) {
      return ledgers;
    }

    return ledgers.filter((ledger) => {
      const searchableText = [
        ledger.orderName,
        ledger.type,
        ledger.reason,
        ledger.sourceType,
        ledger.sourceId,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchableText.includes(normalizedLedgerQuery);
    });
  }, [ledgers, normalizedLedgerQuery]);
  const ledgerPageCount = Math.max(
    1,
    Math.ceil(filteredLedgers.length / ledgerPageSize),
  );
  const currentLedgerPage = Math.min(ledgerPage, ledgerPageCount);
  const pagedLedgers = filteredLedgers.slice(
    (currentLedgerPage - 1) * ledgerPageSize,
    currentLedgerPage * ledgerPageSize,
  );

  useEffect(() => {
    if (fetcher.data?.ok) {
      shopify.toast.show(fetcher.data.message || "操作已保存");
    }

    if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error);
    }
  }, [fetcher.data, shopify]);

  useEffect(() => {
    // 搜索后回到第一页，避免当前页没有数据。
    setLedgerPage(1);
  }, [ledgerQuery, ledgerPageSize]);

  const openOrder = (ledger) => {
    // 积分流水里的订单号点击后，打开 Shopify 原生订单详情页。
    // 手动调分 ADJUST 没有关联订单，所以不会进入这里。
    const orderId = getOrderIdFromLedger(ledger);

    if (!orderId) {
      return;
    }

    const orderAdminPath = getOrderAdminPath(orderId);

    if (orderAdminPath) {
      window.open(orderAdminPath, "_top");
    }
  };
  const toggleTimeline = (eventId) => {
    // 如果已经展开，就收起；如果未展开，就展开。
    setOpenTimelineIds((ids) =>
      ids.includes(eventId)
        ? ids.filter((id) => id !== eventId)
        : [...ids, eventId],
    );
  };

  return (
    <s-page heading={member.name}>
      <s-link slot="breadcrumb-actions" href={`/app/members${navigationSearch}`}>
        会员列表
      </s-link>

      <s-section heading="会员信息">
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
              <s-stack direction="block" gap="base">
                <s-stack direction="block" gap="small">
                  <s-text color="subdued">会员状态</s-text>
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <s-badge tone={getStatusTone(member.status)}>
                      {getStatusLabel(member.status)}
                    </s-badge>
                    {member.status === "ACTIVE" && (
                      <s-badge tone="info">订单付款后自动积分</s-badge>
                    )}
                    {member.status !== "ACTIVE" && (
                      <s-badge tone="info">订单积分会跳过</s-badge>
                    )}
                  </s-stack>
                </s-stack>
                <s-text color="subdued">
                  只有已开通会员才会在订单付款后自动获得积分。
                </s-text>
              </s-stack>

              <s-stack direction="inline" gap="base" alignItems="center">
                {member.status !== "ACTIVE" &&
                  renderStatusForm(fetcher, "ACTIVE", "开通会员", {
                    variant: "primary",
                    loading: isSaving,
                  })}
                {member.status === "ACTIVE" &&
                  renderStatusForm(fetcher, "INACTIVE", "停用会员", {
                    tone: "critical",
                    loading: isSaving,
                  })}
                {member.status === "INACTIVE" &&
                  renderStatusForm(fetcher, "PENDING", "设为待开通", {
                    loading: isSaving,
                  })}
                {member.status === "ACTIVE" &&
                  renderStatusForm(fetcher, "PENDING", "设为待开通", {
                    loading: isSaving,
                  })}
                {member.status === "PENDING" &&
                  renderStatusForm(fetcher, "INACTIVE", "停用会员", {
                    tone: "critical",
                    loading: isSaving,
                  })}
              </s-stack>
            </s-grid>
          </s-box>

          <s-grid gridTemplateColumns="repeat(4, 1fr)" gap="base">
            {renderMetricBox("当前等级", member.levelName)}
            {renderMetricBox("积分余额", member.balance)}
            {renderMetricBox("累计获得", member.lifetimeEarned)}
            {renderMetricBox("累计消耗", member.lifetimeSpent)}
          </s-grid>

          {member.status === "ACTIVE" && (
            <s-box padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <s-stack
                  direction="inline"
                  justifyContent="space-between"
                  alignItems="center"
                >
                  <s-stack direction="block" gap="small">
                    <s-text type="strong">等级进度</s-text>
                    {member.nextLevelName ? (
                      <s-text color="subdued">
                        距离 {member.nextLevelName} 还差 {member.pointsToNextLevel} 积分
                      </s-text>
                    ) : (
                      <s-text color="subdued">已达到最高等级</s-text>
                    )}
                  </s-stack>
                  <s-badge tone="info">{member.levelProgressPercent}%</s-badge>
                </s-stack>

                <div
                  style={{
                    width: "100%",
                    height: "8px",
                    background: "#e3e3e3",
                    borderRadius: "999px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${member.levelProgressPercent}%`,
                      height: "100%",
                      background: "#303030",
                      borderRadius: "999px",
                    }}
                  />
                </div>

                <s-stack direction="inline" justifyContent="space-between">
                  <s-text color="subdued">{member.levelName}</s-text>
                  <s-text color="subdued">
                    {member.nextLevelName || "最高等级"}
                  </s-text>
                </s-stack>
              </s-stack>
            </s-box>
          )}
        </s-stack>
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
                details="正数表示加分，负数表示扣分。"
                required
              ></s-number-field>
              <s-text-field
                label="调整原因"
                name="reason"
                placeholder="例如 客服补偿、异常扣回"
                details="必填。手动调分必须留下原因，方便后续对账。"
                // 前端 required 可以在提交前拦截空原因；后端也会再校验一次，防止绕过页面直接请求。
                required
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
          <s-stack direction="block" gap="base">
            <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="end">
              <s-search-field
                label="搜索积分流水"
                labelAccessibilityVisibility="exclusive"
                placeholder="搜索订单号、类型、原因或来源"
                value={ledgerQuery}
                onInput={(event) => setLedgerQuery(event.currentTarget.value)}
              ></s-search-field>
              <s-select
                label="每页显示"
                value={String(ledgerPageSize)}
                onChange={(event) =>
                  setLedgerPageSize(Number(event.currentTarget.value))
                }
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <s-option key={size} value={String(size)}>
                    {size} 条
                  </s-option>
                ))}
              </s-select>
            </s-grid>

            {pagedLedgers.length > 0 ? (
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">类型</s-table-header>
                  <s-table-header>订单号</s-table-header>
                  <s-table-header>变动积分</s-table-header>
                  <s-table-header>变动后余额</s-table-header>
                  <s-table-header>原因</s-table-header>
                  <s-table-header>时间</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {pagedLedgers.map((ledger) => (
                    <s-table-row key={ledger.id}>
                      <s-table-cell>
                        <s-badge tone={getLedgerTypeTone(ledger.type)}>
                          {ledger.type}
                        </s-badge>
                      </s-table-cell>
                      <s-table-cell>{renderOrderButton(ledger, openOrder)}</s-table-cell>
                      <s-table-cell>{formatPoints(ledger.points)}</s-table-cell>
                      <s-table-cell>{ledger.balanceAfter}</s-table-cell>
                      <s-table-cell>{ledger.reason || "-"}</s-table-cell>
                      <s-table-cell>{formatDate(ledger.createdAt)}</s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            ) : (
              <s-paragraph color="subdued">没有匹配的积分流水。</s-paragraph>
            )}

            {filteredLedgers.length > ledgerPageSize && (
              <s-stack
                direction="inline"
                gap="base"
                justifyContent="end"
                alignItems="center"
              >
                <s-button
                  disabled={currentLedgerPage <= 1}
                  onClick={() => setLedgerPage((page) => Math.max(1, page - 1))}
                >
                  上一页
                </s-button>
                <s-text color="subdued">
                  第 {currentLedgerPage} / {ledgerPageCount} 页
                </s-text>
                <s-button
                  disabled={currentLedgerPage >= ledgerPageCount}
                  onClick={() =>
                    setLedgerPage((page) => Math.min(ledgerPageCount, page + 1))
                  }
                >
                  下一页
                </s-button>
              </s-stack>
            )}
          </s-stack>
        ) : (
          <s-paragraph color="subdued">这个会员还没有积分流水。</s-paragraph>
        )}
      </s-section>

      <s-stack direction="block" gap="base">
        <s-heading>时间线</s-heading>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="createNote" />
          {/* 这里只有评论框保留白色背景和边框；下面的时间线事件不再套卡片，更接近 Shopify 原生时间线。 */}
          <div
            style={{
              background: "#fff",
              border: "1px solid #d4d4d4",
              borderRadius: "12px",
              padding: "16px",
            }}
          >
            <s-stack direction="block" gap="base">
              <s-text-area
                label="添加备注"
                name="content"
                placeholder="发布评论..."
                rows={3}
                required
              ></s-text-area>
              <s-stack direction="inline" justifyContent="end">
                <s-button
                  type="submit"
                  variant="primary"
                  {...(isSaving ? { loading: true } : {})}
                >
                  发布
                </s-button>
              </s-stack>
            </s-stack>
          </div>
        </fetcher.Form>

        {timelineEvents.length > 0 ? (
          <s-stack direction="block" gap="base">
            {timelineEvents.map((event) => (
              // 每条时间线由左侧竖线节点 + 右侧一行内容组成。
              <div
                key={event.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "32px 1fr",
                  columnGap: "12px",
                }}
              >
                <div
                  style={{
                    position: "relative",
                    display: "flex",
                    justifyContent: "center",
                  }}
                >
                  {/* 竖线贯穿上下，模拟 Shopify 订单时间线的时间轴。 */}
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: "-16px",
                      width: "2px",
                      background: "#e3e3e3",
                    }}
                  />
                  {/* 当前事件的小圆点。 */}
                  <div
                    style={{
                      position: "relative",
                      marginTop: "6px",
                      width: "12px",
                      height: "12px",
                      borderRadius: "999px",
                      background: "#303030",
                    }}
                  />
                </div>

                <div style={{ paddingBlock: "4px 16px" }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      columnGap: "16px",
                      alignItems: "center",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        flexWrap: "wrap",
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>
                        {getTimelineTitleParts(event).title}
                      </span>
                      {getTimelineTitleParts(event).summary && (
                        // 备注事件标题会直接露出前 10 个字摘要，完整内容点箭头展开查看。
                        <>
                          <span>-</span>
                          <span>{getTimelineTitleParts(event).summary}</span>
                        </>
                      )}
                      <span style={{ color: "#6d7175" }}>
                        操作人：{event.actorName}
                        {event.actorEmail ? `（${event.actorEmail}）` : ""}
                      </span>
                      {event.content && (
                        // 只有有详情内容的事件才显示箭头；点它展开/收起详情。
                        <button
                          type="button"
                          onClick={() => toggleTimeline(event.id)}
                          style={{
                            width: "20px",
                            height: "20px",
                            padding: 0,
                            border: 0,
                            background: "transparent",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            verticalAlign: "middle",
                          }}
                          aria-label={
                            openTimelineIds.includes(event.id)
                              ? "收起时间线详情"
                              : "展开时间线详情"
                          }
                        >
                          <span
                            style={{
                              width: "8px",
                              height: "8px",
                              borderRight: "2px solid #303030",
                              borderBottom: "2px solid #303030",
                              transform: openTimelineIds.includes(event.id)
                                ? "rotate(45deg)"
                                : "rotate(-45deg)",
                            }}
                          />
                        </button>
                      )}
                    </div>
                    <s-text color="subdued">{formatDate(event.createdAt)}</s-text>
                  </div>
                  {event.content && openTimelineIds.includes(event.id) && (
                    // 展开后的内容用字段名 + 下一行内容展示，避免只出现一段孤立文字。
                    <div style={{ marginTop: "12px" }}>
                      <s-stack direction="block" gap="small">
                        <s-heading>
                          {getTimelineContentParts(event).label}：
                        </s-heading>
                        {isMemberStatusValue(getTimelineContentParts(event).value) ? (
                          <s-stack direction="inline">
                            <s-badge tone={getStatusTone(getTimelineContentParts(event).value)}>
                              {getTimelineContentParts(event).value}
                            </s-badge>
                          </s-stack>
                        ) : (
                          <s-text>{getTimelineContentParts(event).value}</s-text>
                        )}
                      </s-stack>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </s-stack>
        ) : (
          <s-paragraph color="subdued">
            暂无人工时间线。手动调分、状态变更或备注会显示在这里。
          </s-paragraph>
        )}
      </s-stack>

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
