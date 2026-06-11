-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Member" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "email" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "joinedAt" DATETIME,
    "currentLevelId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Member_currentLevelId_fkey" FOREIGN KEY ("currentLevelId") REFERENCES "LevelConfig" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Member" ("createdAt", "currentLevelId", "customerId", "email", "firstName", "id", "lastName", "shop", "updatedAt") SELECT "createdAt", "currentLevelId", "customerId", "email", "firstName", "id", "lastName", "shop", "updatedAt" FROM "Member";
DROP TABLE "Member";
ALTER TABLE "new_Member" RENAME TO "Member";
CREATE INDEX "Member_shop_email_idx" ON "Member"("shop", "email");
CREATE INDEX "Member_shop_status_idx" ON "Member"("shop", "status");
CREATE INDEX "Member_shop_currentLevelId_idx" ON "Member"("shop", "currentLevelId");
CREATE UNIQUE INDEX "Member_shop_customerId_key" ON "Member"("shop", "customerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
