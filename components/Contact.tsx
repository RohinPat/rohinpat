"use client";

import { motion } from "framer-motion";
import { Mail, Linkedin, Github, Send } from "lucide-react";
import { site } from "@/lib/site";

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
        <h1 className="text-4xl md:text-6xl font-semibold tracking-tight mb-14">
          Let's talk.
        </h1>

        <div className="grid md:grid-cols-2 gap-12 border-y border-[var(--border)] py-12">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.35 }}
            className="space-y-2"
          >
            <h2 className="font-mono text-xs uppercase tracking-wider muted mb-6">
              Direct
            </h2>

            <a
              href={`mailto:${site.email}`}
              className="group flex items-start gap-4 py-4 border-b border-[var(--border)] hover:bg-[var(--bg-elevated)] transition-colors"
            >
              <Mail size={20} className="mt-1 muted group-hover:accent transition-colors" />
              <div>
                <div className="font-mono text-xs uppercase tracking-wider dim">
                  Email
                </div>
                <div className="text-base md:text-lg group-hover:accent transition-colors">
                  {site.email}
                </div>
              </div>
            </a>

            <a
              href={site.linkedin}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-start gap-4 py-4 border-b border-[var(--border)] hover:bg-[var(--bg-elevated)] transition-colors"
            >
              <Linkedin size={20} className="mt-1 muted group-hover:accent transition-colors" />
              <div>
                <div className="font-mono text-xs uppercase tracking-wider dim">
                  LinkedIn
                </div>
                <div className="text-base md:text-lg group-hover:accent transition-colors">
                  /in/rohinpat
                </div>
              </div>
            </a>

            <a
              href={site.github}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-start gap-4 py-4 hover:bg-[var(--bg-elevated)] transition-colors"
            >
              <Github size={20} className="mt-1 muted group-hover:accent transition-colors" />
              <div>
                <div className="font-mono text-xs uppercase tracking-wider dim">
                  GitHub
                </div>
                <div className="text-base md:text-lg group-hover:accent transition-colors">
                  @RohinPat
                </div>
              </div>
            </a>

            <div className="pt-10">
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
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.35, delay: 0.05 }}
          >
            <h2 className="font-mono text-xs uppercase tracking-wider muted mb-6">
              Or drop a note
            </h2>

            <form className="space-y-5">
              <div>
                <label className="font-mono text-xs uppercase tracking-wider dim block mb-2">
                  Name
                </label>
                <input
                  type="text"
                  className="w-full px-0 py-3 bg-transparent border-b border-[var(--border)] focus:border-accent focus:outline-none text-base transition-colors"
                  placeholder="Your name"
                />
              </div>

              <div>
                <label className="font-mono text-xs uppercase tracking-wider dim block mb-2">
                  Email
                </label>
                <input
                  type="email"
                  className="w-full px-0 py-3 bg-transparent border-b border-[var(--border)] focus:border-accent focus:outline-none text-base transition-colors"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <label className="font-mono text-xs uppercase tracking-wider dim block mb-2">
                  Message
                </label>
                <textarea
                  rows={5}
                  className="w-full px-0 py-3 bg-transparent border-b border-[var(--border)] focus:border-accent focus:outline-none text-base transition-colors resize-none"
                  placeholder="What's up?"
                />
              </div>

              <button
                type="submit"
                className="group inline-flex items-center gap-2 px-5 py-3 bg-[var(--fg)] text-[var(--bg)] font-medium hover:bg-accent hover:text-white transition-colors"
              >
                <Send size={16} />
                Send
                <span className="transition-transform group-hover:translate-x-0.5">→</span>
              </button>
              <p className="font-mono text-xs dim">
                Form is currently display-only — email me directly above for the fastest reply.
              </p>
            </form>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
