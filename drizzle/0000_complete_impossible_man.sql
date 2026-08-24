CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`business_name` text NOT NULL,
	`phone` text NOT NULL,
	`email` text NOT NULL,
	`gstin` text NOT NULL,
	`address` text NOT NULL,
	`opening_balance` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`expense_no` text NOT NULL,
	`order_id` text NOT NULL,
	`person_id` text NOT NULL,
	`category` text NOT NULL,
	`vendor` text NOT NULL,
	`description` text NOT NULL,
	`expense_date` text NOT NULL,
	`amount` integer NOT NULL,
	`payment_mode` text NOT NULL,
	`receipt_key` text DEFAULT '' NOT NULL,
	`receipt_name` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `expenses_expense_no_unique` ON `expenses` (`expense_no`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_no` text NOT NULL,
	`customer_id` text NOT NULL,
	`order_id` text NOT NULL,
	`billed_person_id` text NOT NULL,
	`issue_date` text NOT NULL,
	`due_date` text NOT NULL,
	`subtotal` integer NOT NULL,
	`tax` integer DEFAULT 0 NOT NULL,
	`total` integer NOT NULL,
	`paid_amount` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'Sent' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`attachment_key` text DEFAULT '' NOT NULL,
	`attachment_name` text DEFAULT '' NOT NULL,
	`attachment_type` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_invoice_no_unique` ON `invoices` (`invoice_no`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`order_no` text NOT NULL,
	`title` text NOT NULL,
	`customer_id` text NOT NULL,
	`assigned_person_id` text NOT NULL,
	`venue` text NOT NULL,
	`event_date` text NOT NULL,
	`status` text DEFAULT 'Planned' NOT NULL,
	`contract_value` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_order_no_unique` ON `orders` (`order_no`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text DEFAULT '' NOT NULL,
	`customer_id` text DEFAULT '' NOT NULL,
	`direction` text NOT NULL,
	`amount` integer NOT NULL,
	`payment_date` text NOT NULL,
	`method` text NOT NULL,
	`reference` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `persons` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`phone` text NOT NULL,
	`email` text NOT NULL,
	`payment_mode` text NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`created_at` text NOT NULL
);
