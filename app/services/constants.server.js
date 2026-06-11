// 这个文件专门放“业务常量”。
// 比如会员状态、积分流水类型、默认规则、默认等级。
// 好处：不同 service 都能复用同一份定义，避免到处写字符串。
// 注意：这里不要写数据库查询，也不要写页面逻辑。

// MVP 默认规则：每消费 10 个货币单位发 1 积分。
// 这里用 cents 保存单位，避免直接用小数金额计算导致精度问题。
export const DEFAULT_RULE = {
  pointsPerCurrencyUnit: 1,
  currencyUnitCents: 1000,
  isEnabled: true,
};

// MVP 默认等级配置。
// thresholdPoints 表示累计获得积分达到多少后进入该等级。
export const DEFAULT_LEVELS = [
  { name: "普通会员", thresholdPoints: 0, sortOrder: 1 },
  { name: "银卡会员", thresholdPoints: 100, sortOrder: 2 },
  { name: "金卡会员", thresholdPoints: 500, sortOrder: 3 },
  { name: "黑金会员", thresholdPoints: 2000, sortOrder: 4 },
];

export const MEMBER_STATUS = {
  PENDING: "PENDING",
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
};

// 积分流水的业务来源类型。后续退款扣回、手动调整可以继续加新的 sourceType。
export const ORDER_PAID_SOURCE_TYPE = "ORDER_PAID";
// 订单取消时使用这个来源类型。
// 它和 ORDER_PAID 共用同一个 order id，但 sourceType 不同，所以可以分别保存“发放”和“冲回”两条流水。
export const ORDER_CANCELLED_SOURCE_TYPE = "ORDER_CANCELLED";
// 订单退款时使用这个来源类型。
// 同一订单可以有多次部分退款，所以 REFUND 的 sourceId 会用 orderId + refundId。
export const ORDER_REFUNDED_SOURCE_TYPE = "ORDER_REFUNDED";
// 商家在后台手动加分/扣分时使用这个来源类型。
// 每次手动调整都会生成一个新的 sourceId，所以每次调整都会留下独立流水。
export const MANUAL_ADJUSTMENT_SOURCE_TYPE = "MANUAL_ADJUSTMENT";
