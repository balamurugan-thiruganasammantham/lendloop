import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata, Viewport } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import "mapbox-gl/dist/mapbox-gl.css";
import "@/styles/globals.scss";
import { clerkAppearance } from "@/lib/clerkAppearance";
import { Providers } from "./providers";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap", axes: ["opsz", "SOFT"] });

export const metadata: Metadata = {
  title: { default: "LendLoop — Borrow what you need. Lend what you don't.", template: "%s · LendLoop" },
  description:
    "LendLoop is a map-first neighbourhood tool library. Find tools nearby, borrow them from neighbours you can trust, and lend what you rarely use.",
  applicationName: "LendLoop",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#f5f2ea",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider
      appearance={clerkAppearance}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/explore"
      signUpFallbackRedirectUrl="/onboarding"
    >
      <html lang="en" className={`${geist.variable} ${geistMono.variable} ${fraunces.variable}`}>
        <body>
          <Providers>{children}</Providers>
        </body>
      </html>
    </ClerkProvider>
  );
}
