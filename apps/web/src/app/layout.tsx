"use client";

import "./globals.css";
import Link from "next/link";
import type { Metadata } from "next";
import { Providers } from "./providers";
import { useState } from "react";
import {
  Home,
  Map as MapIcon,
  Database,
  BarChart,
  Sliders,
  Thermometer,
  Shield,
  Menu,
  X,
  Compass,
} from "@geist-ui/icons";
import Image from "next/image";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
  };

  const nav = [
    { href: "/", label: "Home", icon: Home },
    { href: "/map", label: "Map", icon: MapIcon },
    { href: "/sites", label: "Sites", icon: Compass },
    { href: "/analytics", label: "Analytics", icon: BarChart },
    { href: "/optimize", label: "Optimize", icon: Sliders },
    // { href: "/mini-climate", label: "Mini-Climate", icon: Thermometer },
  ];

  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.cdnfonts.com/css/gilroy-bold?styles=20876,20877,20878,20879,20880"
          rel="stylesheet"
        />
        <link
          rel="apple-touch-icon"
          sizes="180x180"
          href="/apple-touch-icon.png"
        ></link>
        <link
          rel="icon"
          type="image/png"
          sizes="32x32"
          href="/favicon-32x32.png"
        ></link>
        <link
          rel="icon"
          type="image/png"
          sizes="16x16"
          href="/favicon-16x16.png"
        ></link>
        <link rel="manifest" href="/site.webmanifest"></link>
      </head>
      <body>
        <Providers>
          <header className="sticky top-0 z-50 h-[var(--header-h)] border-b border-white/10 bg-black/40 backdrop-blur supports-[backdrop-filter]:bg-black/30">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-[calc(var(--header-h)-1px)] h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
            />

            {/* Main nav container */}
            <nav className="mx-auto flex h-full w-full max-w-6xl items-center justify-between px-4">
              {/* Left: logo/brand */}
              <div className="flex items-center gap-2">
                <Image
                  src="/logotr.png"
                  alt="PlumeScope Logo"
                  className="h-4 w-4"
                  width={4}
                  height={4}
                />
                <span className="font-medium tracking-tight">PlumeScope</span>
                <span className="ml-1 rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] uppercase leading-none text-white/70">
                  Alpha 0.0.1
                </span>
              </div>

              {/* Center: Desktop nav */}
              <div className="hidden items-center gap-1 px-1 py-1 shadow-sm md:flex">
                {nav.map((n) => (
                  <Link
                    key={n.href}
                    href={n.href}
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    {n.icon && (
                      <n.icon aria-hidden className="h-4 w-4 opacity-70" />
                    )}
                    <span>{n.label}</span>
                  </Link>
                ))}
              </div>

              {/* Right: Admin button + Mobile hamburger */}
              <div className="flex items-center gap-2">
                {/* Admin button - hidden on small screens, shown on medium+ */}
                <Link
                  href="/admin"
                  className="hidden items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/10 sm:flex"
                >
                  <Shield aria-hidden className="h-4 w-4 opacity-70" />
                  <span className="hidden lg:inline">Admin</span>
                </Link>

                {/* Hamburger menu button - shown only on mobile */}
                <button
                  onClick={toggleMobileMenu}
                  className="flex items-center justify-center rounded-lg p-2 text-white/80 transition hover:bg-white/10 md:hidden"
                  aria-label="Toggle mobile menu"
                  aria-expanded={isMobileMenuOpen}
                >
                  {isMobileMenuOpen ? (
                    <X className="h-6 w-6" />
                  ) : (
                    <Menu className="h-6 w-6" />
                  )}
                </button>
              </div>
            </nav>

            {/* Mobile menu overlay */}
            {isMobileMenuOpen && (
              <div
                className="fixed inset-0 top-[var(--header-h)] z-40 bg-black/60 backdrop-blur-sm md:hidden"
                onClick={closeMobileMenu}
                aria-hidden="true"
              />
            )}

            {/* Mobile menu panel */}
            <div
              className={`fixed right-0 top-[var(--header-h)] z-50 h-[calc(100vh-var(--header-h))] w-64 transform border-l border-white/10 bg-black/95 backdrop-blur-lg transition-transform duration-300 ease-in-out md:hidden ${
                isMobileMenuOpen ? "translate-x-0" : "translate-x-full"
              }`}
            >
              <nav className="flex h-full flex-col p-4">
                {/* Navigation links */}
                <ul className="flex flex-col gap-2">
                  {nav.map((n) => (
                    <li key={n.href}>
                      <Link
                        href={n.href}
                        onClick={closeMobileMenu}
                        className="flex items-center gap-3 rounded-lg px-4 py-3 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                      >
                        {n.icon && (
                          <n.icon aria-hidden className="h-5 w-5 opacity-70" />
                        )}
                        <span>{n.label}</span>
                      </Link>
                    </li>
                  ))}
                </ul>

                {/* Admin link in mobile menu */}
                <div className="mt-4 border-t border-white/10 pt-4">
                  <Link
                    href="/admin"
                    onClick={closeMobileMenu}
                    className="flex items-center gap-3 rounded-lg px-4 py-3 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <Shield aria-hidden className="h-5 w-5 opacity-70" />
                    <span>Admin</span>
                  </Link>
                </div>
              </nav>
            </div>
          </header>

          <main className="w-full">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
