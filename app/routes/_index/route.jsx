import { redirect } from "react-router";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const search = url.searchParams.toString();

  // Shopify Admin 左侧点击 App 主菜单时，可能会进入根路径 /。
  // 我们真正的后台首页是 /app，所以这里统一把 / 跳转到 /app。
  // search 里可能带 shop、host 等 Shopify 参数，跳转时要保留。
  throw redirect(search ? `/app?${search}` : "/app");
};

export default function App() {
  return null;
}
