-- لینک دعوت مشاور، یادداشت خصوصی، پیش‌نویس برنامه، تخفیف دعوت و سقف دانش‌آموز فعال

-- AlterTable: User
ALTER TABLE `User`
    ADD COLUMN `maxActiveStudents` INTEGER NULL,
    ADD COLUMN `advisorInviteCode` VARCHAR(40) NULL,
    ADD COLUMN `advisorInviteEnabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `studentInviteCode` VARCHAR(40) NULL,
    ADD COLUMN `signupSource` VARCHAR(20) NULL,
    ADD COLUMN `signupInviterId` VARCHAR(100) NULL,
    ADD COLUMN `referralEnabled` BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX `User_advisorInviteCode_key` ON `User`(`advisorInviteCode`);
CREATE UNIQUE INDEX `User_studentInviteCode_key` ON `User`(`studentInviteCode`);

-- AlterTable: Institute
ALTER TABLE `Institute` ADD COLUMN `referralEnabled` BOOLEAN NOT NULL DEFAULT true;

-- AlterTable: StudyPlan (پیش‌نویس)
ALTER TABLE `StudyPlan` ADD COLUMN `isDraft` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: StudentNote
CREATE TABLE `StudentNote` (
    `id` VARCHAR(191) NOT NULL,
    `advisorId` VARCHAR(100) NOT NULL,
    `studentId` VARCHAR(100) NOT NULL,
    `content` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `StudentNote_advisorId_studentId_createdAt_idx`(`advisorId`, `studentId`, `createdAt`),
    INDEX `StudentNote_studentId_idx`(`studentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: Referral
CREATE TABLE `Referral` (
    `id` VARCHAR(191) NOT NULL,
    `inviterId` VARCHAR(100) NOT NULL,
    `inviteeId` VARCHAR(100) NOT NULL,
    `drawnPercent` INTEGER NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `inviterPercent` INTEGER NULL,
    `inviteePercent` INTEGER NULL,
    `activatedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Referral_inviteeId_key`(`inviteeId`),
    INDEX `Referral_inviterId_status_idx`(`inviterId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `StudentNote` ADD CONSTRAINT `StudentNote_advisorId_fkey` FOREIGN KEY (`advisorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `StudentNote` ADD CONSTRAINT `StudentNote_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Referral` ADD CONSTRAINT `Referral_inviterId_fkey` FOREIGN KEY (`inviterId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Referral` ADD CONSTRAINT `Referral_inviteeId_fkey` FOREIGN KEY (`inviteeId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
