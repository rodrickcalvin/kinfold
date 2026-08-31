"use client";

import Link from "next/link";

/** Small shared building blocks so the vault screens stay visually of a piece. */

export function Page({
  title,
  back,
  children,
}: {
  title: string;
  back?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-md px-5 py-12">
      {back && (
        <Link href={back.href} className="text-sm text-muted hover:text-ink">
          ← {back.label}
        </Link>
      )}
      <h1 className="mt-5 font-serif text-3xl tracking-tight">{title}</h1>
      <div className="mt-6">{children}</div>
    </main>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-[15px] outline-none focus:border-accent/50";

export function Button({
  children,
  variant = "primary",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
}) {
  const styles = {
    primary:
      "bg-accent text-accent-ink hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed",
    ghost: "border border-line hover:bg-surface",
    danger: "border border-line text-private hover:bg-surface",
  }[variant];
  return (
    <button
      {...rest}
      className={`rounded-xl px-4 py-2.5 text-sm font-medium transition-opacity ${styles} ${rest.className ?? ""}`}
    >
      {children}
    </button>
  );
}

export function Note({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "warn" | "error";
  children: React.ReactNode;
}) {
  const cls = {
    muted: "border-line bg-surface-2/60 text-muted",
    warn: "border-line bg-accent-soft/60 text-ink",
    error: "border-private/40 bg-surface text-private",
  }[tone];
  return (
    <p className={`rounded-xl border p-3 text-sm leading-relaxed ${cls}`}>
      {children}
    </p>
  );
}
