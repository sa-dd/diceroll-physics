import type { PropsWithChildren } from "react";
import type { Metadata, Viewport } from "next";
import { Inter_Tight } from "next/font/google";

import "@telegram-apps/telegram-ui/dist/styles.css";
import "normalize.css/normalize.css";
import "./_assets/globals.css";

import { ToasterProvider } from "@/components";
import { BaseLayout } from "@/components/shared/base-layout";

const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  variable: "--font-inter-tight",
});

export const metadata: Metadata = {
  title: "123",
  description: "123",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default async function RootLayout({ children }: PropsWithChildren) {
  return (
    <html lang={"en"}>
      <body className={`${interTight.variable}`}>
        <ToasterProvider>
          <BaseLayout>{children}</BaseLayout>
        </ToasterProvider>
      </body>
    </html>
  );
}
