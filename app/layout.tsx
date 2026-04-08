import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Odesa Flow",
  description: "CRM для заказов, базы клиентов и логистики с Firebase синхронизацией",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
