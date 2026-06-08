-- CreateTable
CREATE TABLE "LevelConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "thresholdPoints" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

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
    "currentLevelId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Member_currentLevelId_fkey" FOREIGN KEY ("currentLevelId") REFERENCES "LevelConfig" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Member" ("createdAt", "customerId", "email", "firstName", "id", "lastName", "shop", "updatedAt") SELECT "createdAt", "customerId", "email", "firstName", "id", "lastName", "shop", "updatedAt" FROM "Member";
DROP TABLE "Member";
ALTER TABLE "new_Member" RENAME TO "Member";
CREATE INDEX "Member_shop_email_idx" ON "Member"("shop", "email");
CREATE INDEX "Member_shop_currentLevelId_idx" ON "Member"("shop", "currentLevelId");
CREATE UNIQUE INDEX "Member_shop_customerId_key" ON "Member"("shop", "customerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "LevelConfig_shop_sortOrder_idx" ON "LevelConfig"("shop", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "LevelConfig_shop_name_key" ON "LevelConfig"("shop", "name");

-- CreateIndex
CREATE UNIQUE INDEX "LevelConfig_shop_thresholdPoints_key" ON "LevelConfig"("shop", "thresholdPoints");
