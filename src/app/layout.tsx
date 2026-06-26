import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryProvider } from "@/components/providers/query-provider";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "AdPulse — AI-Powered Ads Reporting",
  description:
    "Automated multi-platform ad reporting with AI-generated insights and natural-language Q&A.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="h-full overflow-hidden font-sans" suppressHydrationWarning>
        <QueryProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
