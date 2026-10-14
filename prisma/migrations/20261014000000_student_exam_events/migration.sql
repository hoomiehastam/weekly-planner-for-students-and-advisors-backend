-- CreateTable
CREATE TABLE `StudentExamEvent` (
    `id` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(100) NOT NULL,
    `title` VARCHAR(190) NOT NULL,
    `kind` ENUM('EXAM', 'QUIZ') NOT NULL DEFAULT 'EXAM',
    `subject` VARCHAR(60) NULL,
    `dueAt` DATETIME(3) NOT NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `StudentExamEvent_studentId_dueAt_idx`(`studentId`, `dueAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `StudentExamEvent` ADD CONSTRAINT `StudentExamEvent_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
