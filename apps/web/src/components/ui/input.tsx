import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = "text", ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm shadow-sm",
          "placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
