import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hyperdriver — Game intelligence",
  description: "Acompanhe as estatísticas dos seus jogos e evolua a cada partida.",
  other: {
    "codex-preview": "development",
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
    <html lang="pt-BR" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
