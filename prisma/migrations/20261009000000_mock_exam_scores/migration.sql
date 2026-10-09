-- CreateTable
CREATE TABLE `MockExamScore` (
    `id` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(100) NOT NULL,
    `title` VARCHAR(190) NOT NULL,
    `takenAt` DATETIME(3) NOT NULL,
    `rank` INTEGER NULL,
    `percentages` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MockExamScore_studentId_takenAt_idx`(`studentId`, `takenAt`),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MockExamScore` ADD CONSTRAINT `MockExamScore_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
