import '@shopify/ui-extensions';

//@ts-ignore
declare module './src/OrderIndexBlock.jsx' {
  const shopify: import('@shopify/ui-extensions/customer-account.order-index.announcement.render').Api;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/ProfileBlock.jsx' {
  const shopify: import('@shopify/ui-extensions/customer-account.profile.block.render').Api;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/membershipApi.js' {
  const shopify:
    | import('@shopify/ui-extensions/customer-account.order-index.announcement.render').Api
    | import('@shopify/ui-extensions/customer-account.profile.block.render').Api;
  const globalThis: { shopify: typeof shopify };
}
