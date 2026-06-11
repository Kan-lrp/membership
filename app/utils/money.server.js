import { DEFAULT_RULE } from "../services/constants.server";

// 这个文件负责“金额和数字转换”。
// 主要负责：
// 1. 把 Shopify 金额字符串转成 cents
// 2. 把前端填写的元转成 cents
// 3. 解析 Shopify MoneySet 结构
// 4. 清洗表单里的数字
// 注意：这里不访问数据库，保持纯工具函数，方便任何 service 复用。

export function parsePositiveInteger(value, fallback) {
  // HTML 表单提交过来的值通常是字符串，这里把它转成整数。
  // 如果转出来不是合法数字，就使用 fallback 默认值。
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function parseIntegerAtLeast(value, fallback, minimum) {
  // 和 parsePositiveInteger 类似，但这里可以指定最小值。
  // “每消费 N 元”的 N 不能为 0，否则积分计算会除以 0。
  const parsed = parsePositiveInteger(value, fallback);
  return Math.max(parsed, minimum);
}

export function currencyUnitYuanToCents(value) {
  // 前端给商家看的是“元”，数据库里保存的是“分”。
  // 例如表单填 10，数据库保存 1000。
  return parseIntegerAtLeast(value, DEFAULT_RULE.currencyUnitCents / 100, 1) * 100;
}

export function currencyUnitCentsToYuan(value) {
  // 把数据库里的“分”转回页面好理解的“元”。
  return Math.max(1, Math.floor(value / 100));
}

export function parseMoneyToCents(value) {
  // Shopify 金额通常是字符串，例如 "128.50"；先转成分再参与积分计算。
  const normalized = String(value ?? "").trim().replace(/,/g, "");

  if (!normalized) {
    return 0;
  }

  const sign = normalized.startsWith("-") ? -1 : 1;
  const unsigned = normalized.replace(/^-/, "");
  const [whole = "0", decimal = ""] = unsigned.split(".");
  const wholeCents = Number.parseInt(whole || "0", 10) * 100;
  const decimalCents = Number.parseInt(decimal.padEnd(2, "0").slice(0, 2), 10);

  if (!Number.isFinite(wholeCents) || !Number.isFinite(decimalCents)) {
    return 0;
  }

  return sign * (wholeCents + decimalCents);
}

export function getMoneySetAmount(value) {
  // Shopify 有些金额字段是 MoneySet 结构，例如 { shop_money: { amount: "10.00" } }。
  // 这个 helper 把这种结构里的 amount 取出来；如果不是 MoneySet，就返回原值。
  // 退款金额字段有时是字符串，有时是 MoneySet，所以统一从这里过一遍。
  return value?.shop_money?.amount ?? value?.presentment_money?.amount ?? value;
}
