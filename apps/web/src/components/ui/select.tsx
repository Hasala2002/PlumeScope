import * as React from "react";
import { cn } from "@/lib/utils";

type SelectRootProps = {
  value: string;
  onValueChange: (v: string) => void;
  children: React.ReactNode;
};

export function Select({ value, onValueChange, children }: SelectRootProps) {
  // Walk children to collect items and metadata
  const items: { value: string; label: string }[] = [];
  let placeholder: string | undefined;
  let id: string | undefined;

  const walk = (nodes: React.ReactNode) => {
    React.Children.forEach(nodes, (child) => {
      if (!child) return;
      if (typeof child === "string" || typeof child === "number") return;
      if (!React.isValidElement(child)) return;
      const typeUnknown = (child as React.ReactElement).type as unknown;
      const displayName = (typeUnknown as { displayName?: string }).displayName;
      const props = (((child as React.ReactElement).props ?? {}) as unknown) as Record<string, unknown>;
      if (displayName === "SelectItem") {
        items.push({ value: String(props.value ?? ""), label: String(props.children ?? "") });
      }
      if (displayName === "SelectValue") {
        placeholder = typeof props.placeholder === "string" ? props.placeholder : placeholder;
      }
      if (displayName === "SelectTrigger" && typeof props.id === "string") {
        id = props.id;
      }
      if (props.children) walk(props.children as React.ReactNode);
    });
  };
  walk(children);

  return (
    <select
      id={id}
      className={cn(
        "h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-accent",
      )}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {items.map((it) => (
        <option key={it.value} value={it.value}>
          {it.label}
        </option>
      ))}
    </select>
  );
}

export function SelectTrigger({ id, className, children }: { id?: string; className?: string; children?: React.ReactNode }) {
  return <div id={id} className={cn(className)}>{children}</div>;
}
SelectTrigger.displayName = "SelectTrigger";

export function SelectValue({ placeholder }: { placeholder?: string }) {
  return null;
}
SelectValue.displayName = "SelectValue";

export function SelectContent({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}
SelectContent.displayName = "SelectContent";

export function SelectItem({ value, children }: { value: string; children: React.ReactNode }) {
  return <option value={value}>{children}</option>;
}
SelectItem.displayName = "SelectItem";
