import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: 'Foodtruck Finder',
  description: 'Hitta foodtrucks nära dig!',
  icons: {
    icon: '/favicon.ico',
  },
};

// app/layout.js
export default function RootLayout({ children }) {
  return (
    <html lang="sv" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className="antialiased bg-rose-50 text-gray-900 min-h-screen"
      >
        {children}
      </body>
    </html>
  );
}
