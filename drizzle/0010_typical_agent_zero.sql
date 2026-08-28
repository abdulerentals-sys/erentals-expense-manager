CREATE TABLE `order_products` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`name` text NOT NULL,
	`quantity` integer NOT NULL,
	`price` integer NOT NULL,
	`amount` integer NOT NULL,
	`created_at` text NOT NULL
);
