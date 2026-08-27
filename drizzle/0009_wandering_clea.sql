ALTER TABLE `orders` ADD `delivery_address` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `delivery_date` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `delivery_time` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `pickup_date` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `pickup_time` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `pickup_address` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `pickup_from_godown` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `contact_person` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `contact_phone` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `product_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `product_price` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `attachment_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `attachment_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `attachment_type` text DEFAULT '' NOT NULL;