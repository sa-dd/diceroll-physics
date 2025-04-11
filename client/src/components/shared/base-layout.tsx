import React, { PropsWithChildren } from "react";
import { cn } from "@/shared";

interface Props {
  className?: string;
}

export const BaseLayout: React.FC<PropsWithChildren<Props>> = ({
  className,
  children,
}) => {
  return (
    <div
      className={cn(
        className,
        "w-full max-w-[640px] mx-auto h-full max-h-screen relative"
      )}
    >
      {children}
    </div>
  );
};
