-- CreateTable
CREATE TABLE "MemberTimelineEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "actorName" TEXT NOT NULL,
    "actorEmail" TEXT,
    "actorUserId" TEXT,
    "metadataJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MemberTimelineEvent_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MemberTimelineEvent_shop_memberId_createdAt_idx" ON "MemberTimelineEvent"("shop", "memberId", "createdAt");
