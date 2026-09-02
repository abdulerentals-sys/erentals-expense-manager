CREATE TABLE `payment_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_accounts_name_key_unique` ON `payment_accounts` (`name_key`);--> statement-breakpoint
INSERT INTO `payment_accounts` (`id`, `name`, `name_key`, `status`, `created_at`) VALUES ('payment-account-hope-and-dream', 'Hope and Dream', 'hope and dream', 'Active', CURRENT_TIMESTAMP);--> statement-breakpoint
INSERT INTO `payment_accounts` (`id`, `name`, `name_key`, `status`, `created_at`) VALUES ('payment-account-erentals', 'eRentals', 'erentals', 'Active', CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `expenses` ADD `funding_source` text DEFAULT 'Reimbursement' NOT NULL;--> statement-breakpoint
ALTER TABLE `expenses` ADD `payment_account_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `expenses` ADD `payment_account_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD `payment_account_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD `payment_account_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD `receipt_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD `receipt_name` text DEFAULT '' NOT NULL;
