ALTER TABLE `order_vendors` ADD `product_type` text DEFAULT 'Quantity-wise' NOT NULL;--> statement-breakpoint
ALTER TABLE `order_vendors` ADD `measurement` real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `person_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `vendor_products` ADD `product_type` text DEFAULT 'Quantity-wise' NOT NULL;