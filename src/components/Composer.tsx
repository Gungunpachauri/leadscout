"use client";

import { ArrowRight, FileUp, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { Button, Kbd, cx } from "./ui";

export function Composer({
  onSubmitText,
  onFile,
  onSample,
  autoFocus,
  compact,
}: {
  onSubmitText: (text: string) => void;
  onFile: (f: File) => void;
  onSample: () => void;
  autoFocus?: boolean;
  compact?: boolean;
}) {
  const [text, setText] = useState("");
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const count = text.split(/[\n,;]+/).filter((s) => s.trim()).length;

  const submit = () => {
    if (!text.trim()) return;
    onSubmitText(text);
    setText("");
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      className={cx(
        "relative overflow-hidden rounded-2xl border bg-surface shadow-soft transition-all",
        drag ? "border-ink ring-4 ring-ink/5" : "border-line focus-within:border-line-strong",
      )}
    >
      <textarea
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={
          "Paste domains, URLs or emails, one per line\n\nacmeplumbing.com\nhttps://www.harborhvac.com/about"
        }
        rows={compact ? 6 : 7}
        spellCheck={false}
        className="block w-full resize-none bg-transparent px-5 pt-5 pb-2 font-mono text-[13px] leading-6 text-ink outline-none placeholder:text-muted/80"
      />
      <div className="flex items-center justify-between gap-2 px-3 pb-3">
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
            <FileUp size={15} strokeWidth={1.75} /> Upload CSV
          </Button>
          <Button variant="ghost" size="sm" onClick={onSample}>
            <Sparkles size={15} strokeWidth={1.75} /> Try sample
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = "";
            }}
          />
        </div>
        <Button variant="primary" size="sm" onClick={submit} disabled={!count} className="pl-3 pr-2.5">
          {count ? `Enrich ${count}` : "Enrich"}
          <ArrowRight size={15} strokeWidth={2} />
          <span className="ml-1 hidden sm:inline">
            <Kbd>Ctrl ↵</Kbd>
          </span>
        </Button>
      </div>
      {drag && (
        <div className="anim-fade pointer-events-none absolute inset-0 flex items-center justify-center bg-surface/90 text-sm font-medium">
          Drop your CSV to import
        </div>
      )}
    </div>
  );
}
