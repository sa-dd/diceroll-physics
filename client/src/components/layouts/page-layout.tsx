"use client";

import { backButton } from "@telegram-apps/sdk-react";
import React, { PropsWithChildren, useEffect } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/shared/lib";
import { motion } from "framer-motion";
import Image from "next/image";

interface Props {
  back?: boolean;
  className?: string;
  background?: string;
}

export const PageLayout: React.FC<PropsWithChildren<Props>> = React.memo(
  ({
    children,
    back = true,
    className,
    background = "/assets/backgrounds/basic.jpg",
  }) => {
    return (
      <motion.div
        className={cn(
          "w-full h-full overflow-y-auto overflow-x-hidden pb-[80px]",
          className
        )}
      >
        {children}
        <Image
          src={background}
          alt="Background"
          className="w-full h-full fixed top-0 left-0 right-0 bottom-0 object-cover z-[-10]"
          priority={true}
          sizes="100vw"
          fill
        />
      </motion.div>
    );
  }
);

PageLayout.displayName = "PageLayout";
