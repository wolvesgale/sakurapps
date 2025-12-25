"use client";

import * as React from "react";

export type SwitchProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">;

export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className = "", disabled, ...props }, ref) => {
    return (
      <label className={`inline-flex items-center ${disabled ? "opacity-50" : ""} ${className}`}>
        <input
          ref={ref}
          type="checkbox"
          className="peer sr-only"
          disabled={disabled}
          {...props}
        />
        <span
          className={[
            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full",
            "border border-slate-700 bg-slate-800 transition-colors",
            "peer-checked:bg-slate-200 peer-checked:border-slate-300",
            "peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-slate-400 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-slate-950"
          ].join(" ")}
        >
          <span
            className={[
              "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
              "peer-checked:translate-x-4"
            ].join(" ")}
          />
        </span>
      </label>
    );
  }
);

Switch.displayName = "Switch";
