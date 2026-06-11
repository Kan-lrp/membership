import { useMemo, useState } from "react";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getMembersData } from "../services/members.server";

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 20, 30];

export const loader = async ({ request }) => {
  // 会员列表属于商家后台页面，所以必须先确认当前请求来自 Shopify Admin。
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const navigationParams = new URLSearchParams(url.search);

  // 有些 Shopify 内部跳转不会自动带 shop 参数。
  // 列表页生成“查看详情”链接前，先确保 navigationParams 里一定有 shop。
  if (!navigationParams.get("shop")) {
    navigationParams.set("shop", session.shop);
  }

  // 按当前店铺读取会员列表，避免不同店铺之间数据串在一起。
  return {
    ...(await getMembersData(session.shop)),
    // 这个值会拼到会员详情链接后面，例如 /app/members/xxx?shop=xxx.myshopify.com。
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

export default function MembersPage() {
  // loader 返回的数据会在这里拿到。
  // navigationSearch 是服务端整理好的 URL 参数，用来保证点击详情后仍然知道当前店铺是谁。
  const { members, navigationSearch } = useLoaderData();
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);
  const activeMembers = members.filter((member) => member.status === "ACTIVE");
  const totalBalance = activeMembers.reduce((sum, member) => sum + member.balance, 0);
  const totalLifetimeEarned = activeMembers.reduce(
    (sum, member) => sum + member.lifetimeEarned,
    0,
  );
  const highestLevelMembers = activeMembers.filter(
    (member) => member.isHighestLevel,
  ).length;
  const normalizedQuery = query.trim().toLowerCase();
  const filteredMembers = useMemo(() => {
    if (!normalizedQuery) {
      return members;
    }

    return members.filter((member) => {
      const searchableText = [
        member.name,
        member.email,
        member.customerId,
        member.levelName,
        getStatusLabel(member.status),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchableText.includes(normalizedQuery);
    });
  }, [members, normalizedQuery]);
  const pageCount = Math.max(1, Math.ceil(filteredMembers.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedMembers = filteredMembers.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  return (
    <s-page heading="会员列表">
      <s-section heading="会员概览">
        {/* 这里是列表页自己的汇总，方便商家不进入首页也能快速看会员规模。 */}
        <s-grid gridTemplateColumns="repeat(4, 1fr)" gap="base">
          {renderMetricBox("会员数", activeMembers.length)}
          {renderMetricBox("总积分余额", totalBalance)}
          {renderMetricBox("累计发放积分", totalLifetimeEarned)}
          {renderMetricBox("最高等级会员", highestLevelMembers)}
        </s-grid>
      </s-section>

      <s-section heading="全部会员">
        <s-stack direction="block" gap="base">
          <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="end">
            <s-search-field
              label="搜索会员"
              labelAccessibilityVisibility="exclusive"
              placeholder="搜索姓名、邮箱、状态或等级"
              value={query}
              onInput={(event) => {
                setQuery(event.currentTarget.value);
                setPage(1);
              }}
            ></s-search-field>
            <s-select
              label="每页显示"
              value={String(pageSize)}
              onChange={(event) => {
                setPageSize(Number(event.currentTarget.value));
                setPage(1);
              }}
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <s-option key={size} value={String(size)}>
                  {size} 条
                </s-option>
              ))}
            </s-select>
          </s-grid>

          {members.length === 0 ? (
            <s-paragraph color="subdued">
              还没有会员。产生一笔带客户的已支付订单后，会员会自动出现在这里。
            </s-paragraph>
          ) : filteredMembers.length > 0 ? (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">会员</s-table-header>
                <s-table-header>邮箱</s-table-header>
                <s-table-header>状态</s-table-header>
                <s-table-header>等级</s-table-header>
                <s-table-header>积分余额</s-table-header>
                <s-table-header>累计获得</s-table-header>
                <s-table-header>流水</s-table-header>
                <s-table-header>最近更新</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {pagedMembers.map((member) => (
                  <s-table-row key={member.id}>
                    <s-table-cell>
                      <s-link href={`/app/members/${member.id}${navigationSearch}`}>
                        {member.name}
                      </s-link>
                    </s-table-cell>
                    <s-table-cell>{member.email || "-"}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={getStatusTone(member.status)}>
                        {getStatusLabel(member.status)}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>{member.levelName}</s-table-cell>
                    <s-table-cell>{member.balance}</s-table-cell>
                    <s-table-cell>{member.lifetimeEarned}</s-table-cell>
                    <s-table-cell>{member.ledgerCount}</s-table-cell>
                    <s-table-cell>{formatDate(member.updatedAt)}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          ) : (
            <s-paragraph color="subdued">
              没有匹配的会员。可以换一个姓名、邮箱、状态或等级关键词。
            </s-paragraph>
          )}
          {filteredMembers.length > pageSize && (
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
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
