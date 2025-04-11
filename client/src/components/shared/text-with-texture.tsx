import React, { PropsWithChildren } from "react";
import { cn } from "@/shared";
import bronze from "@public/assets/bronze.png";
import silver from "@public/assets/silver.png";
import gold from "@public/assets/gold.png";

interface Props {
  className?: string;
  textureType?: string | null;
}

export const TextWithTexture: React.FC<PropsWithChildren<Props>> = ({
  className,
  textureType,
  children,
}) => {
  let backgroundStyle = {};

  if (textureType === "Bronze") {
    backgroundStyle = {
      backgroundImage: `url(${bronze.src})`,
      backgroundSize: "cover",
      backgroundRepeat: "repeat",
      backgroundPosition: "left center",
    };
  } else if (textureType === "Silver") {
    backgroundStyle = {
      backgroundImage: `url(${silver.src})`,
      backgroundSize: "cover",
      backgroundRepeat: "repeat",
      backgroundPosition: "left center",
    };
  } else if (textureType === "Gold") {
    backgroundStyle = {
      backgroundImage: `url(${gold.src})`,
      backgroundSize: "cover",
      backgroundRepeat: "repeat",
      backgroundPosition: "left center",
    };
  }

  return (
    <p
      className={cn(
        "font-extrabold italic",
        textureType && "text-transparent bg-clip-text",
        className
      )}
      style={textureType ? backgroundStyle : {}}
    >
      {children}
    </p>
  );
};
