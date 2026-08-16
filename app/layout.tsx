import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
                <a href="/semaine">Ma semaine</a>
                <a href="/magasins">Mes magasins</a>
              </>
            )}
            {profile.role === "manager" && <a href="/equipe">Mon équipe</a>}
            {profile.role === "admin" && (
              <>
                <a href="/admin/import">Import</a>
                <a href="/admin/utilisateurs">Utilisateurs</a>
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
