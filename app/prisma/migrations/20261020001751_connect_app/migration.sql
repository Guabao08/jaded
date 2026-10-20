-- CreateEnum
CREATE TYPE "ContentOrigin" AS ENUM ('EXTERNAL_UNTRUSTED', 'USER');

-- CreateEnum
CREATE TYPE "StoreKind" AS ENUM ('APP_STORE', 'GOOGLE_PLAY');

-- CreateTable
CREATE TABLE "GitHubInstallation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitHubInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "githubRepoId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "private" BOOLEAN NOT NULL,
    "defaultBranch" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "App" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "repositoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "App_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreListing" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "store" "StoreKind" NOT NULL,
    "storeAppId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "origin" "ContentOrigin" NOT NULL DEFAULT 'EXTERNAL_UNTRUSTED',
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "iconUrl" TEXT,
    "screenshots" TEXT[],
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandProfile" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "iconUrl" TEXT,
    "screenshots" TEXT[],
    "origin" "ContentOrigin" NOT NULL DEFAULT 'USER',
    "tone" TEXT,
    "audience" TEXT,
    "wordsToAvoid" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Update" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "beforeSha" TEXT NOT NULL,
    "afterSha" TEXT NOT NULL,
    "pusherLogin" TEXT,
    "compareUrl" TEXT,
    "origin" "ContentOrigin" NOT NULL DEFAULT 'EXTERNAL_UNTRUSTED',
    "commits" JSONB NOT NULL,
    "pullRequests" JSONB NOT NULL,
    "pushedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Update_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GitHubInstallation_installationId_key" ON "GitHubInstallation"("installationId");

-- CreateIndex
CREATE INDEX "GitHubInstallation_workspaceId_idx" ON "GitHubInstallation"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_githubRepoId_key" ON "Repository"("githubRepoId");

-- CreateIndex
CREATE INDEX "Repository_workspaceId_idx" ON "Repository"("workspaceId");

-- CreateIndex
CREATE INDEX "App_workspaceId_idx" ON "App"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreListing_appId_store_key" ON "StoreListing"("appId", "store");

-- CreateIndex
CREATE UNIQUE INDEX "BrandProfile_appId_key" ON "BrandProfile"("appId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_deliveryId_key" ON "WebhookDelivery"("deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "Update_deliveryId_key" ON "Update"("deliveryId");

-- CreateIndex
CREATE INDEX "Update_workspaceId_createdAt_idx" ON "Update"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "GitHubInstallation" ADD CONSTRAINT "GitHubInstallation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "GitHubInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "App" ADD CONSTRAINT "App_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "App" ADD CONSTRAINT "App_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreListing" ADD CONSTRAINT "StoreListing_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandProfile" ADD CONSTRAINT "BrandProfile_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Update" ADD CONSTRAINT "Update_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Update" ADD CONSTRAINT "Update_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
