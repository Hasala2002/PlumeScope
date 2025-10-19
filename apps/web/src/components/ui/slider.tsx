import * as React from "react";
import { cn } from "@/lib/utils";

export interface SliderProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  value: number[];
  onValueChange?: (value: number[]) => void;
}

export function Slider({ className, value, onValueChange, min = 0, max = 100, step = 1, ...props }: SliderProps) {
  const v = Array.isArray(value) && value.length ? value[0] : 0;
  return (
    <input
      type="range"
      className={cn("w-full", className)}
      value={v}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onValueChange?.([Number(e.target.value)])}
      {...props}
    />
  );
}
