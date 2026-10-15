"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { name: "Work",      href: "/projects" },
  { name: "Off hours", href: "/interests" },
  { name: "Contact",   href: "/contact" },
];

// Floating ink pill — reads the same over paper, ink and signal sections.
export default function Navigation() {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  // Close the mobile menu on route change and on Escape.
  useEffect(() => setIsOpen(false), [pathname]);
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setIsOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  return (
    <nav aria-label="Main" className="fixed top-3 inset-x-3 md:inset-x-0 z-50 flex justify-center pointer-events-none">
      <div className="pointer-events-auto w-full md:w-auto rounded-[1.6rem] bg-[rgba(12,12,11,0.9)] backdrop-blur-md border border-white/10 text-[var(--paper)] shadow-[0_10px_30px_-10px_rgba(0,0,0,0.5)]">
        <div className="flex items-center justify-between gap-2 h-12 pl-1.5 pr-1.5">
          <Link
            href="/"
            aria-label="Rohin Patel — home"
            className="group flex items-center gap-2.5 pr-3 rounded-full"
          >
            <span
              aria-hidden="true"
              className="w-9 h-9 rounded-full bg-[var(--signal)] text-[var(--ink)] grid place-items-center display text-lg transition-transform group-hover:rotate-[-8deg]"
            >
              RP
            </span>
            <span aria-hidden="true" className="font-mono text-xs uppercase tracking-[0.16em]">
              Rohin Patel
            </span>
          </Link>

          <ul className="hidden md:flex items-center gap-0.5">
            {navItems.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.name}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`block px-3.5 py-2 rounded-full font-mono text-[11px] uppercase tracking-[0.16em] transition-colors ${
                      active
                        ? "bg-[var(--signal)] text-[var(--ink)]"
                        : "text-[#c9c5bc] hover:text-[var(--paper)] hover:bg-white/10"
                    }`}
                  >
                    {item.name}
                  </Link>
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            className="md:hidden w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10"
            onClick={() => setIsOpen(!isOpen)}
            aria-label="Toggle menu"
            aria-expanded={isOpen}
            aria-controls="mobile-menu"
          >
            <span aria-hidden="true" className="relative w-5 h-4 block">
              <span
                className={`absolute left-0 right-0 top-0 h-px bg-current transition-transform duration-200 ${
                  isOpen ? "translate-y-[7.5px] rotate-45" : ""
                }`}
              />
              <span
                className={`absolute left-0 right-0 top-1/2 h-px bg-current transition-opacity duration-150 ${
                  isOpen ? "opacity-0" : ""
                }`}
              />
              <span
                className={`absolute left-0 right-0 bottom-0 h-px bg-current transition-transform duration-200 ${
                  isOpen ? "-translate-y-[7.5px] -rotate-45" : ""
                }`}
              />
            </span>
          </button>
        </div>

        <div id="mobile-menu" hidden={!isOpen} className="md:hidden">
          <ul className="px-3 pb-4 pt-1 flex flex-col">
            {navItems.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.name}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setIsOpen(false)}
                    className={`display block py-2 text-4xl animate-[rise_0.25s_ease-out] ${
                      active ? "text-[var(--signal)]" : "text-[var(--paper)]"
                    }`}
                  >
                    {item.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </nav>
  );
}
