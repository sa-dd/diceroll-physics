"use client";

import React, { PropsWithChildren } from "react";
import { cn } from "@/shared/lib/utils";
import { Toaster } from "react-hot-toast";

interface Props {
  className?: string;
}

export const ToasterProvider: React.FC<PropsWithChildren<Props>> = ({
  className,
  children,
}) => {
  return (
    <>
      <Toaster
        containerClassName={cn(className)}
        toastOptions={{
          style: {
            backgroundColor: "var(--dark)",
            color: "var(--white)",
            fontWeight: 500,
            width: "100%",
            borderRadius: "var(--radius)",
            minHeight: "50px",
          },
          success: {
            iconTheme: {
              primary: "var(--green)",
              secondary: "var(--dark)",
            },
          },
          error: {
            iconTheme: {
              primary: "var(--red)",
              secondary: "var(--dark)",
            },
          },
        }}
      />

      {children}
    </>
  );
};
