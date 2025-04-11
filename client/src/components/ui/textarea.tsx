import * as React from "react";

import { cn } from "@/shared/lib";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[180px] w-full bg-dark-1 border border-border px-4 py-3 text-[14px] outline-none resize-none rounded-[14px]",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
