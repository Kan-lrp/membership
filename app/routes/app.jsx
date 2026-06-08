import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

// 这个 loader 属于 /app 这个父路由。
// 只要访问 /app 或它下面的子页面，都会先确认 Shopify Admin 登录状态。
export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // AppProvider 需要 apiKey 才能把页面嵌入 Shopify Admin。
  // SHOPIFY_API_KEY 由 Shopify CLI 在 dev 环境里注入。
  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  // 读取上面 loader 返回的 apiKey。
  const { apiKey } = useLoaderData();

  return (
    // AppProvider 是 Shopify 嵌入式 App 的外壳。
    // embedded 表示这个页面运行在 Shopify Admin iframe 里。
    <AppProvider embedded apiKey={apiKey}>
      {/* s-app-nav 是 Shopify Admin 左侧/顶部的 App 内导航。 */}
      <s-app-nav>
        <s-link href="/app">会员积分</s-link>
        <s-link href="/app/members">会员列表</s-link>
        <s-link href="/app/logs">日志</s-link>
      </s-app-nav>

      {/* Outlet 会渲染子路由。访问 /app 时，这里显示 app._index.jsx。 */}
      <Outlet />
    </AppProvider>
  );
}

// Shopify 需要 React Router 捕获一些异常响应，并带上 Shopify 需要的 headers。
// 这个 ErrorBoundary 是官方模板保留下来的，不建议删。
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  // 让 Shopify 的嵌入式 App headers 正常透传。
  return boundary.headers(headersArgs);
};
