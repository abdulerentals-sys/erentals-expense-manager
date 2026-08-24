import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://erentals-expense-manager.aliabdul.chatgpt.site"),
  title: "eRentals Expense Manager",
  description: "Manage customers, invoices, orders, people, expenses and payments in one connected workspace.",
  openGraph: {
    title: "eRentals Expense Manager",
    description: "Customers, invoices, orders and expenses — connected.",
    type: "website",
    images: [{ url: "/og.png", width: 1731, height: 909, alt: "eRentals Expense Manager" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "eRentals Expense Manager",
    description: "Customers, invoices, orders and expenses — connected.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
