"use client";

import { Check, X } from "lucide-react";
import { useState } from "react";
import { INDUSTRIES } from "@/lib/score";
import type { IcpSettings } from "@/lib/types";
import { Button, Sheet, cx } from "./ui";

export function BuyBoxSheet({
  open, onClose, icp, setIcp, sender, setSender,
}: {
  open: boolean;
  onClose: () => void;
  icp: IcpSettings;
  setIcp: (f: (s: IcpSettings) => IcpSettings) => void;
  sender: { name?: string; firm?: string };
  setSender: (f: (s: { name?: string; firm?: string }) => { name?: string; firm?: string }) => void;
}) {
  const [kw, setKw] = useState("");
  const field = "h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm outline-none transition focus:border-ink";

  return (
    <Sheet open={open} onClose={onClose} label="Buy-box settings" width={440}>
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <div>
          <h2 className="text-[15px] font-semibold">Buy-box</h2>
          <p className="text-[13px] text-muted">Scores update instantly. Nothing is re-crawled.</p>
        </div>
        <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-ink">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 space-y-8 overflow-y-auto px-6 py-6">
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="text-[13px] font-medium">Target industries</h3>
            {icp.industries.length > 0 && (
              <button className="text-xs text-muted hover:text-ink" onClick={() => setIcp((s) => ({ ...s, industries: [] }))}>Clear</button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {INDUSTRIES.map((ind) => {
              const on = icp.industries.includes(ind);
              return (
                <button
                  key={ind}
                  onClick={() => setIcp((s) => ({ ...s, industries: on ? s.industries.filter((x) => x !== ind) : [...s.industries, ind] }))}
                  className={cx(
                    "flex items-center justify-between rounded-lg border px-3 py-2 text-left text-[13px] transition-colors",
                    on ? "border-ink bg-subtle text-ink" : "border-line text-ink-2 hover:border-line-strong",
                  )}
                >
                  <span className="truncate">{ind}</span>
                  {on && <Check size={14} strokeWidth={2.5} className="shrink-0" />}
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-[13px] font-medium">Keywords</h3>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const k = kw.trim();
              if (k && !icp.keywords.includes(k)) setIcp((s) => ({ ...s, keywords: [...s.keywords, k] }));
              setKw("");
            }}
          >
            <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="commercial, B2B, family" className={field} />
            <Button type="submit" className="h-10">Add</Button>
          </form>
          {icp.keywords.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {icp.keywords.map((k) => (
                <span key={k} className="inline-flex items-center gap-1 rounded-md bg-subtle py-1 pl-2.5 pr-1 text-[13px]">
                  {k}
                  <button aria-label={`Remove ${k}`} onClick={() => setIcp((s) => ({ ...s, keywords: s.keywords.filter((x) => x !== k) }))} className="rounded p-0.5 text-muted hover:bg-hover hover:text-ink">
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="text-[13px] font-medium">Minimum years in business</h3>
            <span className="font-mono text-[13px] tabular-nums">{icp.minYears}+</span>
          </div>
          <input
            type="range" min={0} max={40} value={icp.minYears}
            onChange={(e) => setIcp((s) => ({ ...s, minYears: +e.target.value }))}
            className="w-full"
          />
          <div className="mt-1 flex justify-between text-[11px] text-muted"><span>0</span><span>20</span><span>40</span></div>
        </section>

        <section>
          <h3 className="mb-1 text-[13px] font-medium">Outreach signature</h3>
          <p className="mb-3 text-[13px] text-muted">Used in drafted emails.</p>
          <div className="grid grid-cols-2 gap-2">
            <input value={sender.name ?? ""} onChange={(e) => setSender((s) => ({ ...s, name: e.target.value }))} placeholder="Your name" className={field} />
            <input value={sender.firm ?? ""} onChange={(e) => setSender((s) => ({ ...s, firm: e.target.value }))} placeholder="Firm" className={field} />
          </div>
        </section>
      </div>

      <div className="border-t border-line px-6 py-4">
        <Button variant="primary" className="w-full" onClick={onClose}>Done</Button>
      </div>
    </Sheet>
  );
}
