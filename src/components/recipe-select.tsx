"use client";

import { useEffect, useRef, useState } from "react";

type Option = { id: string; title: string; version: number };

export function RecipeSelect({ value, options, onChange }: { value: string; options: Option[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.id === value);

  useEffect(() => {
    function close(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return <div className="recipe-select" ref={root}>
    <button type="button" className={`recipe-select-trigger ${open ? "open" : ""}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <span>{selected ? `${selected.title} · v${selected.version}` : "Select recipe…"}</span><span className="recipe-select-chevron">⌄</span>
    </button>
    {open && <div className="recipe-select-menu" role="listbox">
      <button type="button" className={`recipe-select-option ${!value ? "selected" : ""}`} onClick={() => { onChange(""); setOpen(false); }}>Select recipe…</button>
      {options.map((option) => <button type="button" role="option" aria-selected={option.id === value} className={`recipe-select-option ${option.id === value ? "selected" : ""}`} key={option.id} onClick={() => { onChange(option.id); setOpen(false); }}>{option.title} · v{option.version}</button>)}
    </div>}
  </div>;
}
