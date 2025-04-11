import React, { PropsWithChildren } from "react";
import { cn } from "@/shared";
import gold from "@public/assets/gold.png";

interface Props {
  className?: string;
}

export const ItalicText: React.FC<PropsWithChildren<Props>> = ({
  className,
  children,
}) => {
  return (
    <h1
      className={cn(
        "text-transparent bg-clip-text drop-shadow-outline",
        className
      )}
      style={{
        backgroundImage: `url(${gold.src})`,
        backgroundSize: "cover",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "left center",
      }}
    >
      {children}
    </h1>
  );
};
