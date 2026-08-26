CREATE TABLE `vendor_products` (
	`id` text PRIMARY KEY NOT NULL,
	`vendor_id` text NOT NULL,
	`name` text NOT NULL,
	`pricing_basis` text NOT NULL,
	`rental_charge` integer NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `order_vendors` ADD `product_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `order_vendors` ADD `pricing_basis` text DEFAULT 'Per event' NOT NULL;--> statement-breakpoint
ALTER TABLE `order_vendors` ADD `unit_rate` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `order_vendors` ADD `quantity` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `order_vendors` ADD `rental_days` integer DEFAULT 1 NOT NULL;