"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { name: "Projects",   href: "/projects" },
  { name: "Experience", href: "/experience" },
  { name: "Skills",     href: "/skills" },
  { name: "Interests",  href: "/interests" },
  { name: "Contact",    href: "/contact" },
];

export default function Navigation() {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-[var(--bg)]/80 backdrop-blur border-b border-[var(--border)]">
      <div className="max-w-6xl mx-auto px-6 md:px-10">
        <div className="flex items-center justify-between h-14">
          <Link
            href="/"
            className="font-mono text-sm tracking-tight hover:accent transition-colors"
          >
            rohin patel
            <span className="accent">.</span>
          </Link>

          <div className="hidden md:flex items-center gap-8">
            {navItems.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`font-mono text-xs uppercase tracking-[0.18em] transition-colors ${
                    active ? "accent" : "muted hover:text-[var(--fg)]"
                  }`}
                >
                  {item.name}
                </Link>
              );
            })}
          </div>

          <button
            className="md:hidden w-10 h-10 flex items-center justify-center"
            onClick={() => setIsOpen(!isOpen)}
            aria-label="Toggle menu"
          >
            <div className="w-5 h-4 relative flex flex-col justify-between">
              <motion.span
                className="w-full h-px bg-[var(--fg)] origin-center"
                animate={{ rotate: isOpen ? 45 : 0, y: isOpen ? 7 : 0 }}
                transition={{ duration: 0.25 }}
              />
              <motion.span
                className="w-full h-px bg-[var(--fg)]"
                animate={{ opacity: isOpen ? 0 : 1 }}
                transition={{ duration: 0.2 }}
              />
              <motion.span
                className="w-full h-px bg-[var(--fg)] origin-center"
                animate={{ rotate: isOpen ? -45 : 0, y: isOpen ? -7 : 0 }}
                transition={{ duration: 0.25 }}
              />
            </div>
          </button>
        </div>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="md:hidden overflow-hidden border-t border-[var(--border)] bg-[var(--bg)]"
          >
            <div className="px-6 py-6 flex flex-col gap-5">
              {navItems.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setIsOpen(false)}
                    className={`font-mono text-sm uppercase tracking-wider ${
                      active ? "accent" : "muted"
                    }`}
                  >
                    {item.name}
                  </Link>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
