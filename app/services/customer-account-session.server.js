import crypto from "node:crypto";

const TOKEN_CLOCK_TOLERANCE_SECONDS = 60;

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function getShopFromClaim(value) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).hostname;
  } catch {
    return String(value).replace(/^https?:\/\//, "").split("/")[0] || null;
  }
}

export function verifyCustomerAccountSessionToken(token) {
  const secret = process.env.SHOPIFY_API_SECRET;

  if (!secret) {
    throw new Error("SHOPIFY_API_SECRET is not configured.");
  }

  const parts = String(token ?? "").split(".");

  if (parts.length !== 3) {
    throw new Error("Invalid session token.");
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const header = JSON.parse(base64UrlDecode(encodedHeader));

  if (header.alg !== "HS256") {
    throw new Error("Unsupported session token algorithm.");
  }

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");

  if (!timingSafeEqual(signature, expectedSignature)) {
    throw new Error("Invalid session token signature.");
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload));
  const now = Math.floor(Date.now() / 1000);

  if (payload.exp && payload.exp + TOKEN_CLOCK_TOLERANCE_SECONDS < now) {
    throw new Error("Session token has expired.");
  }

  if (payload.nbf && payload.nbf - TOKEN_CLOCK_TOLERANCE_SECONDS > now) {
    throw new Error("Session token is not active yet.");
  }

  if (
    process.env.SHOPIFY_API_KEY &&
    payload.aud &&
    payload.aud !== process.env.SHOPIFY_API_KEY
  ) {
    throw new Error("Session token audience does not match this app.");
  }

  const shop = getShopFromClaim(payload.shop ?? payload.dest ?? payload.iss);
  const customerId = payload.sub;

  if (!shop || !customerId) {
    throw new Error("Session token is missing customer account context.");
  }

  return {
    shop,
    customerId,
    payload,
  };
}
