import { useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getDashboardData,
  updateRuleConfig,
} from "../services/dashboard.server";
import { updateLevelConfigs } from "../services/levels.server";

const DEFAULT_LEDGER_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 20, 30];

// loader 是 React Router 的服务端数据读取函数。
// 用户打开 /app 页面时，它会先在服务端运行，把返回的数据交给下面的 React 组件。
export const loader = async ({ request }) => {
  // authenticate.admin 会确认当前请求来自已安装并登录的 Shopify Admin。
  // session.shop 是当前店铺域名，后面所有查询都按 shop 隔离数据。
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const navigationParams = new URLSearchParams(url.search);

  if (!navigationParams.get("shop")) {
    navigationParams.set("shop", session.shop);
  }

  // 页面打开时读取当前店铺的积分规则、会员概览和最近流水。
  return {
    ...(await getDashboardData(session.shop)),
    navigationSearch: `?${navigationParams.toString()}`,
  };
};

// action 是 React Router 的服务端表单处理函数。
// 页面里的 <fetcher.Form method="post"> 提交时，会进入这个函数。
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  // request.formData() 读取浏览器表单字段，字段名来自 JSX 里各 input 的 name。
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    if (intent === "updateLevels") {
      const ids = formData.getAll("levelId");
      const names = formData.getAll("levelName");
      const thresholds = formData.getAll("thresholdPoints");

      await updateLevelConfigs(
        session.shop,
        ids.map((id, index) => ({
          id,
          name: names[index],
          thresholdPoints: thresholds[index],
        })),
      );

      return { ok: true, message: "等级规则已保存" };
    }

    // 保存 App Home 表单里的积分发放规则。
    await updateRuleConfig(session.shop, {
      pointsPerCurrencyUnit: formData.get("pointsPerCurrencyUnit"),
      currencyUnitYuan: formData.get("currencyUnitYuan"),
      isEnabled: formData.get("isEnabled") === "on",
    });

    return { ok: true, message: "积分规则已保存" };
  } catch (error) {
    // 不把校验错误抛给 React Router 错误边界，而是返回给页面显示。
    return { ok: false, error: error.message };
  }
};

function formatDate(value) {
  // 把数据库里的 ISO 时间字符串转成中文日期时间，方便后台直接阅读。
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatPoints(points) {
  // 正数前面加 +，后台看流水时更容易区分“获得”和“扣减”。
  return `${points > 0 ? "+" : ""}${points}`;
}

function getLedgerTypeTone(type) {
  // 同一个流水类型固定同一个 badge 色调，方便扫表时快速识别。
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

function renderMetricBox(label, value, helpText) {
  // 这里用普通函数返回一小块 JSX，避免四个统计卡片重复写同样结构。
  // s-box / s-stack / s-text 是 Shopify Polaris Web Components，不需要额外 import。
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack direction="block" gap="small">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value}</s-heading>
        {helpText && <s-paragraph color="subdued">{helpText}</s-paragraph>}
      </s-stack>
    </s-box>
  );
}

export default function Index() {
  // useLoaderData() 读取上面 loader 返回的数据。
  // 所以这里的 data 包含 rule、levels、summary、members、recentLedgers。
  const data = useLoaderData();
  const recentMembers = data.members.slice(0, 5);

  // useFetcher() 适合做“不跳转页面”的表单提交。
  // 保存规则后页面不会刷新跳走，只会把 action 的返回值放到 fetcher.data。
  const fetcher = useFetcher();

  // useAppBridge() 提供 Shopify Admin 里的能力，例如右下角 toast 提示。
  const shopify = useAppBridge();

  // fetcher.state 有 idle / submitting / loading 等状态。
  // 只要不是 idle，就说明保存按钮可以显示 loading。
  const isSaving = fetcher.state !== "idle";
  const [ledgerQuery, setLedgerQuery] = useState("");
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerPageSize, setLedgerPageSize] = useState(DEFAULT_LEDGER_PAGE_SIZE);
  const [isEditingPointRule, setIsEditingPointRule] = useState(false);
  const [isEditingLevelRules, setIsEditingLevelRules] = useState(false);
  const normalizedLedgerQuery = ledgerQuery.trim().toLowerCase();
  const filteredLedgers = useMemo(() => {
    if (!normalizedLedgerQuery) {
      return data.recentLedgers;
    }

    return data.recentLedgers.filter((ledger) => {
      const searchableText = [
        ledger.customerName,
        ledger.customerEmail,
        ledger.orderName,
        ledger.type,
        ledger.reason,
        ledger.sourceId,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchableText.includes(normalizedLedgerQuery);
    });
  }, [data.recentLedgers, normalizedLedgerQuery]);
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
    // useEffect 会在页面渲染后执行。
    // 当 action 返回 { ok: true } 后，fetcher.data.ok 变成 true，这里弹出保存成功提示。
    if (fetcher.data?.ok) {
      shopify.toast.show(fetcher.data.message || "保存成功");
      setIsEditingPointRule(false);
      setIsEditingLevelRules(false);
    }

    if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error);
    }
  }, [fetcher.data, shopify]);

  useEffect(() => {
    // 搜索条件变化后回到第一页，避免停留在不存在的页码上。
    setLedgerPage(1);
  }, [ledgerQuery, ledgerPageSize]);

  const openOrder = (ledger) => {
    const orderId = getOrderIdFromLedger(ledger);

    if (!orderId) {
      return;
    }

    const orderAdminPath = getOrderAdminPath(orderId);

    if (orderAdminPath) {
      window.open(orderAdminPath, "_top");
    }
  };

  return (
    <s-page heading="会员积分">
      {/* 一个 s-section 就是页面里的一个内容区块。 */}
      <s-section heading="会员概览">
        {/* 汇总卡片来自 PointsAccount 和 Member 聚合数据。 */}
        <s-grid gridTemplateColumns="repeat(4, 1fr)" gap="base">
          {renderMetricBox("会员数", data.summary.memberCount)}
          {renderMetricBox("当前积分余额", data.summary.totalBalance)}
          {renderMetricBox("累计发放积分", data.summary.lifetimeEarned)}
          {renderMetricBox("累计消耗积分", data.summary.lifetimeSpent)}
        </s-grid>
      </s-section>

      <s-section heading="积分规则">
        {/* MVP 现在支持一个简单但更灵活的规则：每消费 N 元，发 M 积分。 */}
        {/* fetcher.Form 会把表单提交给本文件里的 action，但不会让整个页面跳转。 */}
        <s-stack direction="block" gap="base">
          {fetcher.data?.error && isEditingPointRule && (
            <s-banner tone="critical">{fetcher.data.error}</s-banner>
          )}
          <s-banner tone="info">
            订单支付 webhook 到达后，系统会按“每消费 N 元发 M
            积分”的规则写入积分流水，并按累计获得积分自动更新会员等级。
          </s-banner>

          {!isEditingPointRule ? (
            <s-grid gridTemplateColumns="1fr 1fr 1fr auto" gap="base" alignItems="center">
              {renderMetricBox("每消费多少元", data.rule.currencyUnitYuan)}
              {renderMetricBox("发放多少积分", data.rule.pointsPerCurrencyUnit)}
              {renderMetricBox("积分发放状态", data.rule.isEnabled ? "已启用" : "已停用")}
              <s-stack alignItems="end">
                <s-button onClick={() => setIsEditingPointRule(true)}>
                  编辑
                </s-button>
              </s-stack>
            </s-grid>
          ) : (
            <fetcher.Form method="post">
              <s-grid
                gridTemplateColumns="1fr 1fr auto auto auto"
                gap="base"
                alignItems="end"
              >
                {/* name 必须和 action 里 formData.get("currencyUnitYuan") 对应。 */}
                <s-number-field
                  label="每消费多少元"
                  name="currencyUnitYuan"
                  value={String(data.rule.currencyUnitYuan)}
                  min={1}
                  step={1}
                ></s-number-field>
                {/* name 必须和 action 里 formData.get("pointsPerCurrencyUnit") 对应。 */}
                <s-number-field
                  label="发放多少积分"
                  name="pointsPerCurrencyUnit"
                  value={String(data.rule.pointsPerCurrencyUnit)}
                  min={0}
                  step={1}
                ></s-number-field>
                {/* 开关选中时表单会提交 isEnabled=on；未选中时这个字段不会提交。 */}
                <s-switch
                  label="启用积分发放"
                  name="isEnabled"
                  checked={data.rule.isEnabled}
                ></s-switch>
                <s-button
                  type="submit"
                  variant="primary"
                  // 保存中时给按钮加 loading，让用户知道提交正在进行。
                  {...(isSaving ? { loading: true } : {})}
                >
                  保存规则
                </s-button>
                <s-button
                  type="button"
                  variant="secondary"
                  onClick={() => setIsEditingPointRule(false)}
                >
                  取消
                </s-button>
              </s-grid>
            </fetcher.Form>
          )}
        </s-stack>
      </s-section>

      <s-section heading="等级规则">
        {/* 等级规则来自 LevelConfig。这里先支持编辑现有等级，不做新增/删除。 */}
        <s-stack direction="block" gap="base">
          {fetcher.data?.error && isEditingLevelRules && (
            <s-banner tone="critical">{fetcher.data.error}</s-banner>
          )}
          <s-banner tone="info">
            修改等级名称或积分门槛后，系统会重新计算所有已开通会员的当前等级。
            必须保留一个 0 积分门槛的最低等级。
          </s-banner>

          {!isEditingLevelRules ? (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">等级</s-table-header>
                <s-table-header>累计获得积分门槛</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {data.levels.map((level) => (
                  <s-table-row key={level.id}>
                    <s-table-cell>{level.name}</s-table-cell>
                    <s-table-cell>{level.thresholdPoints}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          ) : (
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="updateLevels" />
              <s-stack direction="block" gap="base">
                <s-table>
                  <s-table-header-row>
                    <s-table-header listSlot="primary">等级名称</s-table-header>
                    <s-table-header>累计获得积分门槛</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {data.levels.map((level) => (
                      <s-table-row key={level.id}>
                        <s-table-cell>
                          <input type="hidden" name="levelId" value={level.id} />
                          <s-text-field
                            label="等级名称"
                            labelAccessibilityVisibility="exclusive"
                            name="levelName"
                            value={level.name}
                            required
                          ></s-text-field>
                        </s-table-cell>
                        <s-table-cell>
                          <s-number-field
                            label="累计获得积分门槛"
                            labelAccessibilityVisibility="exclusive"
                            name="thresholdPoints"
                            value={String(level.thresholdPoints)}
                            min={0}
                            step={1}
                            required
                          ></s-number-field>
                        </s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
                <s-stack direction="inline" justifyContent="end" gap="base">
                  <s-button
                    type="button"
                    variant="secondary"
                    onClick={() => setIsEditingLevelRules(false)}
                  >
                    取消
                  </s-button>
                  <s-button
                    type="submit"
                    variant="primary"
                    {...(isSaving ? { loading: true } : {})}
                  >
                    保存等级规则
                  </s-button>
                </s-stack>
              </s-stack>
            </fetcher.Form>
          )}

          {!isEditingLevelRules && (
            <s-stack direction="inline" justifyContent="end">
              <s-button
                type="button"
                onClick={() => setIsEditingLevelRules(true)}
              >
                编辑等级规则
              </s-button>
            </s-stack>
          )}
        </s-stack>
      </s-section>

      <s-section>
        <s-stack direction="block" gap="base">
          <s-stack
            direction="inline"
            justifyContent="space-between"
            alignItems="center"
          >
            <s-heading>最近会员</s-heading>
            <s-link href={`/app/members${data.navigationSearch}`}>查看更多</s-link>
          </s-stack>
          {/* 这里先做最小会员列表，完整会员详情页放到后续阶段。 */}
          {/* 这是 React 常见写法：有数据就渲染表格，没有数据就渲染空状态文案。 */}
          {recentMembers.length > 0 ? (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">会员</s-table-header>
                <s-table-header>邮箱</s-table-header>
                <s-table-header>等级</s-table-header>
                <s-table-header>积分余额</s-table-header>
                <s-table-header>累计获得</s-table-header>
                <s-table-header>最近更新</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {/* map 会把 members 数组里的每个会员转换成一行表格。 */}
                {recentMembers.map((member) => (
                  // key 帮助 React 识别每一行，列表渲染时必须给一个稳定唯一值。
                  <s-table-row key={member.id}>
                    <s-table-cell>
                      <s-link href={`/app/members/${member.id}${data.navigationSearch}`}>
                        {member.name}
                      </s-link>
                    </s-table-cell>
                    <s-table-cell>{member.email || "-"}</s-table-cell>
                    <s-table-cell>{member.levelName}</s-table-cell>
                    <s-table-cell>{member.balance}</s-table-cell>
                    <s-table-cell>{member.lifetimeEarned}</s-table-cell>
                    <s-table-cell>{formatDate(member.updatedAt)}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          ) : (
            <s-paragraph color="subdued">
              还没有会员积分数据。产生一笔已支付客户订单后，这里会显示会员账户。
            </s-paragraph>
          )}
        </s-stack>
      </s-section>

      <s-section heading="最近积分流水">
        {/* 每次积分余额变化都应该有一条流水，用来对账和排查重复发放。 */}
        {/* recentLedgers 来自 PointsLedger，按创建时间倒序读取，前端按选择的每页条数分页。 */}
        {data.recentLedgers.length > 0 ? (
          <s-stack direction="block" gap="base">
            <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="end">
              <s-search-field
                label="搜索积分流水"
                labelAccessibilityVisibility="exclusive"
                placeholder="搜索会员、订单号、类型、原因"
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
                  <s-table-header listSlot="primary">会员</s-table-header>
                  <s-table-header>订单号</s-table-header>
                  <s-table-header>类型</s-table-header>
                  <s-table-header>变动积分</s-table-header>
                  <s-table-header>变动后余额</s-table-header>
                  <s-table-header>来源</s-table-header>
                  <s-table-header>时间</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {pagedLedgers.map((ledger) => (
                    <s-table-row key={ledger.id}>
                      <s-table-cell>
                        {ledger.memberId ? (
                          <s-link href={`/app/members/${ledger.memberId}${data.navigationSearch}`}>
                            {ledger.customerName}
                          </s-link>
                        ) : (
                          ledger.customerName || "-"
                        )}
                      </s-table-cell>
                      <s-table-cell>{renderOrderButton(ledger, openOrder)}</s-table-cell>
                      <s-table-cell>
                        <s-badge tone={getLedgerTypeTone(ledger.type)}>
                          {ledger.type}
                        </s-badge>
                      </s-table-cell>
                      <s-table-cell>{formatPoints(ledger.points)}</s-table-cell>
                      <s-table-cell>{ledger.balanceAfter}</s-table-cell>
                      <s-table-cell>{ledger.reason || ledger.sourceId}</s-table-cell>
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
          <s-paragraph color="subdued">
            暂无积分流水。订单支付 webhook 成功处理后会自动生成记录。
          </s-paragraph>
        )}
      </s-section>

      <s-section slot="aside" heading="当前 MVP 范围">
        {/* slot="aside" 表示这个区块放到页面侧边栏。 */}
        <s-unordered-list>
          <s-list-item>订单支付后自动发放积分</s-list-item>
          <s-list-item>积分规则支持每消费 N 元发 M 积分</s-list-item>
          <s-list-item>会员等级按累计获得积分自动更新</s-list-item>
          <s-list-item>会员账户、余额、流水和 webhook 状态落库</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  // Shopify 的边界处理需要把特定 headers 带回去，保持嵌入式 App 正常工作。
  return boundary.headers(headersArgs);
};
