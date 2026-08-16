import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { createServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { SignOutButton } from "./sign-out-button";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Prépa visite",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createServerClient();
  const profile = await getCurrentProfile(supabase);

  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {profile && (
          <nav className="flex gap-4 border-b p-4 items-center">
            {profile.role === "commercial" && (
              <>
                <Link href="/semaine">Ma semaine</Link>
                <Link href="/magasins">Mes magasins</Link>
              </>
            )}
            {profile.role === "manager" && <Link href="/equipe">Mon équipe</Link>}
            {profile.role === "admin" && (
              <>
                <Link href="/admin/import">Import</Link>
                <Link href="/admin/utilisateurs">Utilisateurs</Link>
              </>
            )}
            <span className="ml-auto text-sm text-gray-500">{profile.email}</span>
            <SignOutButton />
          </nav>
        )}
        <main>{children}</main>
      </body>
    </html>
  );
}
