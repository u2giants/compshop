import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

interface AutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder?: string;
  id?: string;
  name?: string;
  className?: string;
  renderSuggestion?: (suggestion: string) => React.ReactNode;
}

export default function AutocompleteInput({
  value,
  onChange,
  suggestions,
  placeholder,
  id,
  name,
  className,
  renderSuggestion,
}: AutocompleteInputProps) {
  const [open, setOpen] = useState(false);
  const [filtered, setFiltered] = useState<string[]>([]);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!value) {
      setFiltered([]);
      return;
    }
    const lower = value.toLowerCase().trim();
    // Fuzzy match: substring OR subsequence (in-order char match), then score
    const scored: { s: string; score: number }[] = [];
    for (const s of suggestions) {
      const sl = s.toLowerCase();
      let score = -1;
      if (sl === lower) score = 0;
      else if (sl.startsWith(lower)) score = 1;
      else if (sl.includes(lower)) score = 2 + Math.abs(sl.length - lower.length) * 0.01;
      else {
        // Subsequence fuzzy match
        let i = 0;
        for (let j = 0; j < sl.length && i < lower.length; j++) {
          if (sl[j] === lower[i]) i++;
        }
        if (i === lower.length) score = 5 + (sl.length - lower.length) * 0.05;
      }
      if (score >= 0) scored.push({ s, score });
    }
    scored.sort((a, b) => a.score - b.score);
    setFiltered(scored.slice(0, 8).map((x) => x.s));
  }, [value, suggestions]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={wrapperRef} className="relative">
      <Input
        id={id}
        name={name}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
          {filtered.map((item) => (
            <button
              key={item}
              type="button"
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                onChange(item);
                setOpen(false);
              }}
            >
              {renderSuggestion ? renderSuggestion(item) : item}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
