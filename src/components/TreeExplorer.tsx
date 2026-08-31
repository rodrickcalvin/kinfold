"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CARD_H, CARD_W, type Layout, type LaidOutPerson } from "@/lib/layout";
import type { VisiblePerson } from "@/lib/visibility";

const MIN_SCALE = 0.3;
const MAX_SCALE = 2.4;
const TAP_SLOP = 6; // px of movement still counted as a tap, not a drag

interface Props {
  layout: Layout;
  treeName: string;
  viewer: { role: string; redactedCount: number; scoped: boolean };
}

export default function TreeExplorer({ layout, treeName, viewer }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [selected, setSelected] = useState<VisiblePerson | null>(null);

  /* -------------------------------------------------------------- */
  /* Gestures                                                        */
  /* -------------------------------------------------------------- */

  // Live pointer positions. A ref, not state: these change every frame and
  // re-rendering on each move would make the pan stutter on a phone.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const moved = useRef(0);

  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const { clientWidth: w, clientHeight: h } = el;
    const scale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, Math.min(w / layout.width, h / layout.height, 1)),
    );
    setView({
      scale,
      x: (w - layout.width * scale) / 2,
      y: (h - layout.height * scale) / 2,
    });
  }, [layout.width, layout.height]);

  useEffect(() => {
    fit();
  }, [fit]);

  const zoomAbout = useCallback((factor: number, cx: number, cy: number) => {
    setView((v) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      const k = scale / v.scale;
      // Keep the point under the fingers pinned while the world scales around it.
      return { scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = 0;
    if (pointers.current.size === 2) pinch.current = null;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, next);

    const pts = [...pointers.current.values()];

    if (pts.length >= 2) {
      const [a, b] = pts;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = wrapRef.current?.getBoundingClientRect();
      const cx = (a.x + b.x) / 2 - (rect?.left ?? 0);
      const cy = (a.y + b.y) / 2 - (rect?.top ?? 0);
      if (pinch.current) {
        zoomAbout(dist / pinch.current.dist, cx, cy);
      }
      pinch.current = { dist, scale: view.scale };
      moved.current = TAP_SLOP + 1;
      return;
    }

    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    moved.current += Math.abs(dx) + Math.abs(dy);
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    const cx = e.clientX - (rect?.left ?? 0);
    const cy = e.clientY - (rect?.top ?? 0);
    if (e.ctrlKey) {
      zoomAbout(Math.exp(-e.deltaY / 200), cx, cy);
    } else {
      setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    }
  };

  const centerZoom = (factor: number) => {
    const el = wrapRef.current;
    if (!el) return;
    zoomAbout(factor, el.clientWidth / 2, el.clientHeight / 2);
  };

  const selectIfTap = (node: LaidOutPerson) => {
    if (moved.current > TAP_SLOP) return;
    setSelected(node.person);
  };

  const generationLabel = useMemo(
    () => `${layout.nodes.length} people · ${layout.generations} generations`,
    [layout.nodes.length, layout.generations],
  );

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-bg">
      {/* Header */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 p-3">
        <div className="pointer-events-auto mx-auto flex max-w-2xl items-center gap-3 rounded-2xl border border-line bg-surface/85 px-4 py-2.5 backdrop-blur card-shadow">
          <Link
            href="/"
            className="-ml-1 shrink-0 rounded-lg px-1.5 py-1 text-muted transition-colors hover:text-ink"
            aria-label="All trees"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M15 5l-7 7 7 7"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold leading-tight">
              {treeName}
            </h1>
            <p className="truncate text-xs text-muted">{generationLabel}</p>
          </div>
          <RoleBadge role={viewer.role} />
        </div>

        {viewer.redactedCount > 0 && (
          <p className="mx-auto mt-2 max-w-2xl px-1 text-center text-[11px] text-muted">
            {viewer.redactedCount} living{" "}
            {viewer.redactedCount === 1 ? "person is" : "people are"} hidden or
            limited for you
            {viewer.scoped ? ", and your view is scoped to one branch" : ""}.
          </p>
        )}
      </header>

      {/* Canvas */}
      <div
        ref={wrapRef}
        className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={endPointer}
        onWheel={onWheel}
      >
        <div
          className="relative origin-top-left will-change-transform"
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
          }}
        >
          <svg
            width={layout.width}
            height={layout.height}
            className="absolute inset-0 text-line"
            aria-hidden
          >
            {layout.edges.map((e) => (
              <path
                key={e.id}
                d={e.d}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
              />
            ))}
          </svg>

          {layout.nodes.map((n) => (
            <PersonCard
              key={n.person.id}
              node={n}
              selected={selected?.id === n.person.id}
              onSelect={() => selectIfTap(n)}
            />
          ))}
        </div>
      </div>

      {/* Zoom controls */}
      <div className="absolute bottom-6 right-4 z-20 flex flex-col overflow-hidden rounded-2xl border border-line bg-surface/90 backdrop-blur card-shadow">
        <ControlButton label="Zoom in" onClick={() => centerZoom(1.25)}>
          +
        </ControlButton>
        <div className="h-px bg-line" />
        <ControlButton label="Zoom out" onClick={() => centerZoom(0.8)}>
          −
        </ControlButton>
        <div className="h-px bg-line" />
        <ControlButton label="Fit to screen" onClick={fit}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M4 9V5a1 1 0 011-1h4M20 9V5a1 1 0 00-1-1h-4M4 15v4a1 1 0 001 1h4M20 15v4a1 1 0 01-1 1h-4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </ControlButton>
      </div>

      {selected && (
        <PersonSheet person={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ControlButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-11 w-11 items-center justify-center text-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink active:bg-surface-2"
    >
      {children}
    </button>
  );
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-medium capitalize text-accent">
      {role}
    </span>
  );
}

function PersonCard({
  node,
  selected,
  onSelect,
}: {
  node: LaidOutPerson;
  selected: boolean;
  onSelect: () => void;
}) {
  const p = node.person;
  const hidden = p.visibility === "hidden";
  const limited = p.visibility === "limited";

  return (
    <button
      type="button"
      onPointerUp={onSelect}
      disabled={hidden}
      aria-label={hidden ? "Private person" : p.label}
      className={[
        "absolute flex flex-col justify-center rounded-xl border px-3 text-left transition-shadow",
        hidden
          ? "hatched cursor-default border-dashed border-line bg-surface/60"
          : "border-line bg-surface card-shadow",
        selected ? "ring-2 ring-accent" : "",
      ].join(" ")}
      style={{ left: node.x, top: node.y, width: CARD_W, height: CARD_H }}
    >
      {hidden ? (
        <span className="text-[13px] italic text-private">Private</span>
      ) : (
        <>
          <span className="truncate text-[13.5px] font-semibold leading-snug">
            {p.label}
          </span>
          {p.sublabel && (
            <span className="mt-0.5 truncate text-[11.5px] text-muted">
              {p.sublabel}
            </span>
          )}
          {limited && (
            <span className="mt-1 inline-flex w-fit items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
              details hidden
            </span>
          )}
        </>
      )}
    </button>
  );
}

function PersonSheet({
  person,
  onClose,
}: {
  person: VisiblePerson;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const d = person.detail;

  return (
    <div className="absolute inset-0 z-30 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={person.label}
        className="relative w-full max-w-md rounded-t-3xl border border-line bg-surface p-5 pb-8 card-shadow sm:rounded-3xl sm:pb-5"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line sm:hidden" />

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold leading-tight">{person.label}</h2>
            {person.sublabel && (
              <p className="mt-0.5 text-sm text-muted">{person.sublabel}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            ✕
          </button>
        </div>

        {d ? (
          <dl className="mt-5 space-y-3 text-sm">
            {d.birthSurname && d.birthSurname !== d.surname && (
              <Row label="Born as">{`${d.given} ${d.birthSurname}`}</Row>
            )}
            {d.birth && (
              <Row label="Born">
                {[d.birth.date, d.birth.place].filter(Boolean).join(" · ")}
              </Row>
            )}
            {d.death && (
              <Row label="Died">
                {[d.death.date, d.death.place].filter(Boolean).join(" · ")}
              </Row>
            )}
            {d.note && <Row label="Note">{d.note}</Row>}
          </dl>
        ) : (
          <p className="mt-5 rounded-xl bg-surface-2 p-3 text-sm text-muted">
            This person is living, so their dates, places and notes are not shown
            at your access level.
          </p>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[76px_1fr] gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}
