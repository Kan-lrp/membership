-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "email" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PointsAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "lifetimeEarned" INTEGER NOT NULL DEFAULT 0,
    "lifetimeSpent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PointsAccount_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PointsLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reason" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "metadataJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PointsLedger_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PointsLedger_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PointsAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RuleConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "pointsPerCurrencyUnit" INTEGER NOT NULL DEFAULT 1,
    "currencyUnitCents" INTEGER NOT NULL DEFAULT 100,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "shopifyWebhookId" TEXT,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "Member_shop_email_idx" ON "Member"("shop", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Member_shop_customerId_key" ON "Member"("shop", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "PointsAccount_memberId_key" ON "PointsAccount"("memberId");

-- CreateIndex
CREATE INDEX "PointsAccount_shop_balance_idx" ON "PointsAccount"("shop", "balance");

-- CreateIndex
CREATE UNIQUE INDEX "PointsAccount_shop_memberId_key" ON "PointsAccount"("shop", "memberId");

-- CreateIndex
CREATE INDEX "PointsLedger_shop_createdAt_idx" ON "PointsLedger"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "PointsLedger_shop_memberId_idx" ON "PointsLedger"("shop", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "PointsLedger_shop_sourceType_sourceId_key" ON "PointsLedger"("shop", "sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "RuleConfig_shop_key" ON "RuleConfig"("shop");

-- CreateIndex
CREATE INDEX "WebhookEvent_shop_status_idx" ON "WebhookEvent"("shop", "status");

-- CreateIndex
CREATE INDEX "WebhookEvent_shop_receivedAt_idx" ON "WebhookEvent"("shop", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_shop_topic_resourceId_key" ON "WebhookEvent"("shop", "topic", "resourceId");
