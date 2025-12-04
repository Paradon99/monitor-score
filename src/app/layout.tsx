import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "监控评分协作台",
  description: "监控配置与评分工作台",
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
