import * as React from "react";
import { cn } from "@/lib/utils";

export function Accordion({ children, className }: { children: React.ReactNode; type?: "single" | "multiple"; defaultValue?: string[]; className?: string }) {
  return <div className={cn(className)}>{children}</div>;
}

export function AccordionItem({ children, className }: { value: string; children: React.ReactNode; className?: string }) {
  return <div className={cn("border-b border-border py-2", className)}>{children}</div>;
}

export function AccordionTrigger({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <button type="button" className={cn("w-full text-left font-medium", className)}>
      {children}
    </button>
  );
}

export function AccordionContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mt-2 space-y-2", className)}>{children}</div>;
}
