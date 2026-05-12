"use client";

import { motion } from "framer-motion";
import { Mail, Linkedin, Github, ArrowUpRight } from "lucide-react";
import { site } from "@/lib/site";

const channels = [
  {
    icon: Mail,
    label: "Email",
    sub: "fastest reply, send anything.",
    handle: site.email,
    href: `mailto:${site.email}?subject=Hello%20from%20your%20site`,
    badge: "best for actual conversations",
  },
  {
    icon: Linkedin,
    label: "LinkedIn",
    sub: "the canonical CV — current job, prior co-ops, full work history.",
    handle: "/in/rohinpat",
    href: site.linkedin,
    badge: "this is the resume",
  },
  {
    icon: Github,
    label: "GitHub",
    sub: "shipped code, side projects, this site's source.",
    handle: "@RohinPat",
    href: site.github,
    badge: null,
  },
];

export default function Contact() {
  return (
    <section className="py-12 md:py-20 px-6 md:px-10">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-baseline gap-4 mb-3">
          <span className="font-mono text-xs uppercase tracking-[0.2em] accent">
            Contact
          </span>
          <span className="font-mono text-xs uppercase tracking-[0.2em] dim">
            / say hi
          </span>
        </div>
        <h1 className="text-4xl md:text-6xl font-semibold tracking-tight mb-6 text-balance">
          Easiest way? <span className="accent">Just email me.</span>
        </h1>
        <p className="muted max-w-prose text-pretty text-base md:text-lg mb-14">
          No contact form, no captcha, no auto-responder. The link below opens your mail
          client. Subject line is pre-filled — say whatever.
        </p>

        <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {channels.map((c, i) => {
            const Icon = c.icon;
            const isExternal = c.href.startsWith("http");
            return (
              <motion.li
                key={c.label}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.35, delay: i * 0.05 }}
              >
                <a
                  href={c.href}
                  target={isExternal ? "_blank" : undefined}
                  rel={isExternal ? "noopener noreferrer" : undefined}
                  className="group block py-7 md:py-9 grid grid-cols-12 gap-4 hover:bg-[var(--bg-elevated)] -mx-4 px-4 transition-colors"
                >
                  <div className="col-span-2 md:col-span-1 flex items-start">
                    <Icon size={22} className="muted group-hover:accent transition-colors mt-1" />
                  </div>
                  <div className="col-span-10 md:col-span-7">
                    <div className="flex items-baseline gap-3 mb-1">
                      <span className="font-mono text-xs uppercase tracking-wider muted">
                        {c.label}
                      </span>
                      {c.badge && (
                        <span className="font-mono text-[10px] uppercase tracking-wider accent">
                          {c.badge}
                        </span>
                      )}
                    </div>
                    <h2 className="text-2xl md:text-3xl font-semibold tracking-tight mb-2 group-hover:accent transition-colors">
                      {c.handle}
                    </h2>
                    <p className="muted text-sm md:text-base text-pretty">{c.sub}</p>
                  </div>
                  <div className="col-span-12 md:col-span-4 md:text-right self-center">
                    <span className="inline-flex items-center gap-1 font-mono text-xs uppercase tracking-wider muted group-hover:accent transition-colors">
                      Open
                      <ArrowUpRight size={14} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                    </span>
                  </div>
                </a>
              </motion.li>
            );
          })}
        </ul>

        <div className="mt-14 grid grid-cols-1 md:grid-cols-12 gap-8">
          <div className="md:col-span-7">
            <h3 className="font-mono text-xs uppercase tracking-wider muted mb-4">
              Currently
            </h3>
            <ul className="space-y-2 muted">
              <li className="flex gap-3"><span className="accent">—</span>Heading to WHOOP full-time, iOS</li>
              <li className="flex gap-3"><span className="accent">—</span>Open to side projects + collaborations</li>
              <li className="flex gap-3"><span className="accent">—</span>Always down to talk iOS / ML / weird ideas</li>
              <li className="flex gap-3"><span className="accent">—</span>Or just say hi</li>
            </ul>
          </div>
          <div className="md:col-span-5">
            <h3 className="font-mono text-xs uppercase tracking-wider muted mb-4">
              Response time
            </h3>
            <p className="muted text-pretty">
              Usually within a day on email or LinkedIn. If it&apos;s urgent, email is the
              channel I check first.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
