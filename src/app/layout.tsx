import type { Metadata } from "next";
import "./globals.css";
import "./inventory-reference.css";
import "./cycle-reference.css";
import "./finance.css";

export const metadata: Metadata = {
  title: "Kōsh Operations",
  description: "Meal production operations platform",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
