"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpRight,
  Check,
  Coffee,
  Copy,
  Github,
  Lightbulb,
  Linkedin,
  Mail,
  Send,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatBostonTime } from "@/lib/clock";
import { site } from "@/lib/site";

type Vibe = {
  id: string;
  label: string;
  icon: typeof Coffee;
  subject: string;
  body: string;
};

const VIBES: Vibe[] = [
  {
    id: "coffee",
    label: "Coffee chat",
    icon: Coffee,
    subject: "Coffee chat?",
    body:
      "Hey Rohin —\n\nLoved poking around the site. Free for a 20-minute coffee chat sometime in the next couple of weeks?\n\n— [your name]",
  },
  {
    id: "hiring",
    label: "Hiring / opportunity",
    icon: Sparkles,
    subject: "Quick question — opportunity",
    body:
      "Hey Rohin —\n\nWe're a [company] working on [thing]. Looking for [role]. Quick context:\n\n• [team / scope]\n• [tech]\n• [timing]\n\nWorth a call?\n\n— [your name]",
  },
  {
    id: "idea",
    label: "Project idea",
    icon: Lightbulb,
    subject: "An idea I think you'd like",
    body:
      "Hey Rohin —\n\nHad an idea I think you'd enjoy:\n\n[the idea]\n\nDown to riff on it?\n\n— [your name]",
  },
  {
    id: "hello",
    label: "Just saying hi",
    icon: Wand2,
    subject: "Hey",
    body: "Hey Rohin —\n\n",
  },
];

const channels = [
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

function useBostonClock() {
  const [time, setTime] = useState<string | null>(null);
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTime(formatBostonTime(now));
      const h = new Date(
        now.toLocaleString("en-US", { timeZone: "America/New_York" }),
      ).getHours();
      setHour(h);
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);
  return { time, hour };
}

function buildMailto(to: string, subject: string, body: string) {
  const qs = new URLSearchParams();
  if (subject) qs.set("subject", subject);
  if (body) qs.set("body", body);
  const q = qs.toString().replace(/\+/g, "%20");
  return `mailto:${to}${q ? `?${q}` : ""}`;
}

export default function Contact() {
  const [activeVibe, setActiveVibe] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [edited, setEdited] = useState(false);
  const [copied, setCopied] = useState(false);
  const { time, hour } = useBostonClock();

  const awake = hour == null ? null : hour >= 7 && hour < 23;

  const pickVibe = useCallback((v: Vibe) => {
    setActiveVibe(v.id);
    setSubject(v.subject);
    setBody(v.body);
    setEdited(false);
  }, []);

  const onSubjectChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSubject(e.target.value);
    if (activeVibe) setEdited(true);
  };
  const onBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setBody(e.target.value);
    if (activeVibe) setEdited(true);
  };

  const mailtoHref = useMemo(
    () =>
      buildMailto(
        site.email,
        subject || "Hello from your site",
        body,
      ),
    [subject, body],
  );

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(site.email);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignored */
    }
  };

  return (
    <section className="py-12 md:py-20 px-6 md:px-10">
      <div className="max-w-5xl mx-auto">
        {/* Header --------------------------------------------------- */}
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

        {/* Live status pill ---------------------------------------- */}
        <div className="inline-flex items-center gap-2 mb-8 font-mono text-[11px] uppercase tracking-wider muted border border-[var(--border)] px-3 py-1.5">
          <motion.span
            className={`w-1.5 h-1.5 rounded-full ${
              awake === false ? "bg-[var(--fg-dim)]" : "bg-accent"
            }`}
            animate={awake === false ? {} : { opacity: [1, 0.4, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
          <span>
            it&apos;s <span className="text-[var(--fg)]">{time ?? "—:—"}</span>{" "}
            in boston
          </span>
          <span className="dim">·</span>
          <span className={awake === false ? "" : "accent"}>
            {awake === null
              ? "checking…"
              : awake
                ? "probably awake"
                : "asleep — reply in the morning"}
          </span>
        </div>

        <p className="muted max-w-prose text-pretty text-base md:text-lg mb-12">
          This is a launch pad, not a form. No captcha, no auto-responder,
          nothing gets submitted to me — picking a vibe just composes a{" "}
          <code className="font-mono text-sm accent">mailto:</code> and hands
          it to your mail app.
        </p>

        {/* Composer ------------------------------------------------- */}
        <div className="border border-[var(--border-strong)] bg-[var(--bg-elevated)] mb-14">
          {/* Vibe chips */}
          <div className="px-5 md:px-7 pt-5 md:pt-7 pb-4 border-b border-[var(--border)]">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] muted mb-3">
              What brings you by?
            </p>
            <div className="flex flex-wrap gap-2">
              {VIBES.map((v) => {
                const Icon = v.icon;
                const active = activeVibe === v.id;
                return (
                  <button
                    key={v.id}
                    onClick={() => pickVibe(v)}
                    className={`group inline-flex items-center gap-2 px-3 py-1.5 border font-mono text-xs uppercase tracking-wider transition-all duration-200 ${
                      active
                        ? "border-accent bg-accent text-white"
                        : "border-[var(--border-strong)] muted hover:border-accent hover:text-[var(--fg)]"
                    }`}
                  >
                    <Icon size={13} className={active ? "" : "muted group-hover:accent transition-colors"} />
                    <span>{v.label}</span>
                  </button>
                );
              })}
              <AnimatePresence>
                {activeVibe && edited && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    onClick={() => {
                      setActiveVibe(null);
                      setSubject("");
                      setBody("");
                      setEdited(false);
                    }}
                    className="font-mono text-[10px] uppercase tracking-wider dim hover:accent transition-colors ml-1"
                  >
                    clear
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Subject + body */}
          <div className="px-5 md:px-7 pt-5 pb-5 md:pb-7 flex flex-col gap-4">
            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] muted mb-1.5 block">
                Subject
              </span>
              <input
                type="text"
                value={subject}
                onChange={onSubjectChange}
                placeholder="Hello from your site"
                className="w-full bg-[var(--bg)] border border-[var(--border)] focus:border-accent focus:outline-none transition-colors px-3 py-2 font-mono text-sm text-[var(--fg)] placeholder:dim"
              />
            </label>

            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] muted mb-1.5 block">
                Message
              </span>
              <textarea
                value={body}
                onChange={onBodyChange}
                rows={6}
                placeholder="Whatever you'd say in an email."
                className="w-full bg-[var(--bg)] border border-[var(--border)] focus:border-accent focus:outline-none transition-colors px-3 py-2 font-mono text-sm text-[var(--fg)] placeholder:dim resize-y"
              />
            </label>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <motion.a
                href={mailtoHref}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.97 }}
                className="group inline-flex items-center gap-2 px-5 py-3 bg-accent text-white font-mono text-xs uppercase tracking-[0.2em] hover:bg-[#c4005a] transition-colors"
              >
                <Send size={14} />
                Open in mail app
                <ArrowUpRight
                  size={14}
                  className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                />
              </motion.a>

              <button
                onClick={copyEmail}
                className="group inline-flex items-center gap-2 px-5 py-3 border border-[var(--border-strong)] hover:border-accent transition-colors font-mono text-xs uppercase tracking-[0.2em]"
              >
                <AnimatePresence mode="wait">
                  {copied ? (
                    <motion.span
                      key="copied"
                      initial={{ opacity: 0, scale: 0.7 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.7 }}
                      transition={{ duration: 0.15 }}
                      className="inline-flex items-center gap-2 accent"
                    >
                      <Check size={14} />
                      copied
                    </motion.span>
                  ) : (
                    <motion.span
                      key="copy"
                      initial={{ opacity: 0, scale: 0.7 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.7 }}
                      transition={{ duration: 0.15 }}
                      className="inline-flex items-center gap-2 muted group-hover:text-[var(--fg)] transition-colors"
                    >
                      <Copy size={14} />
                      copy address
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>

              <span className="font-mono text-[10px] uppercase tracking-wider dim ml-auto truncate max-w-full">
                → <span className="text-[var(--fg)]">{site.email}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Other channels ------------------------------------------ */}
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] muted mb-3">
          Or skip the email
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
                  className="group block py-6 md:py-7 grid grid-cols-12 gap-4 hover:bg-[var(--bg-elevated)] -mx-4 px-4 transition-colors"
                >
                  <div className="col-span-2 md:col-span-1 flex items-start">
                    <Icon
                      size={22}
                      className="muted group-hover:accent transition-colors mt-1"
                    />
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
                    <h2 className="text-xl md:text-2xl font-semibold tracking-tight mb-2 group-hover:accent transition-colors">
                      {c.handle}
                    </h2>
                    <p className="muted text-sm md:text-base text-pretty">
                      {c.sub}
                    </p>
                  </div>
                  <div className="col-span-12 md:col-span-4 md:text-right self-center">
                    <span className="inline-flex items-center gap-1 font-mono text-xs uppercase tracking-wider muted group-hover:accent transition-colors">
                      Open
                      <ArrowUpRight
                        size={14}
                        className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                      />
                    </span>
                  </div>
                </a>
              </motion.li>
            );
          })}
        </ul>

        {/* Currently / Response time ------------------------------- */}
        <div className="mt-14 grid grid-cols-1 md:grid-cols-12 gap-8">
          <div className="md:col-span-7">
            <h3 className="font-mono text-xs uppercase tracking-wider muted mb-4">
              Currently
            </h3>
            <ul className="space-y-2 muted">
              <li className="flex gap-3">
                <span className="accent">—</span>Just graduated NEU CS &apos;26
              </li>
              <li className="flex gap-3">
                <span className="accent">—</span>Returning to WHOOP full-time
                July 2026
              </li>
              <li className="flex gap-3">
                <span className="accent">—</span>Building solo until then —
                open to projects + ideas
              </li>
              <li className="flex gap-3">
                <span className="accent">—</span>Or just say hi
              </li>
            </ul>
          </div>
          <div className="md:col-span-5">
            <h3 className="font-mono text-xs uppercase tracking-wider muted mb-4">
              Response time
            </h3>
            <p className="muted text-pretty">
              {awake === false
                ? "It's late in Boston. Email lands tonight, reply in the morning."
                : "Usually within a day on email or LinkedIn. If it's urgent, email is the channel I check first."}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
