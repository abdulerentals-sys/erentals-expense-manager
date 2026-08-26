CREATE TABLE `order_vendors` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`vendor_id` text NOT NULL,
	`product_name` text NOT NULL,
	`amount` integer NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vendors` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`contact_person` text DEFAULT '' NOT NULL,
	`phone` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`gstin` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`payment_mode` text DEFAULT 'Bank transfer' NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `expenses` ADD `vendor_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD `vendor_id` text DEFAULT '' NOT NULL;