import type { Metadata, Viewport } from "next";
import "./globals.css";
import { KeyProvider } from "@/components/KeyProvider";

export const metadata: Metadata = {
  title: "Kinfold",
  description:
    "A family tree you can share without handing over your family's data.",
  manifest: "/manifest.webmanifest",
  // Nothing in this app should show up in a search result.
  robots: { index: false, follow: false },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icon.svg" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The tree canvas has its own pinch-zoom. Letting the browser zoom as well
  // makes both feel broken, so we own the gesture.
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f3ee" },
    { media: "(prefers-color-scheme: dark)", color: "#15120f" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <KeyProvider>{children}</KeyProvider>
      </body>
    </html>
  );
}
