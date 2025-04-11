"use client";

import React, { PropsWithChildren } from "react";
import { cn } from "@/shared/lib";

interface Props {
  className?: string;
}

export const Container: React.FC<PropsWithChildren<Props>> = ({
  className,
  children,
}) => {
  return <div className={cn(className, "w-full px-[14px]")}>{children}</div>;
};
