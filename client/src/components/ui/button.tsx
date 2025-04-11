"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/shared/lib";

const buttonVariants = cva(
  "inline-flex items-center justify-center text-sm font-semibold leading-none",
  {
    variants: {
      variant: {
        default:
          "bg-btn-white text-black border border-black disabled:opacity-70",
        gray: "bg-btn-dark text-white",
        outline: "text-white border border-[#fff]/[5%]",
        white:
          "bg-btn-white text-black border border-black disabled:opacity-70",
      },
      size: {
        default: "py-1 px-2",
        sm: "py-1 px-2 rounded-sm",
        lg: "h-11 rounded-sm w-full px-2.5",
        icon: "h-11 w-11 aspect-square rounded-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

const spinnerVariants = cva("rounded-full animate-spin border-2", {
  variants: {
    size: {
      default: "w-5 h-5",
      sm: "w-4 h-4",
      lg: "w-6 h-6",
      icon: "w-5 h-5",
    },
    variant: {
      default: "border-dark-1 border-t-transparent",
      gray: "border-white border-t-transparent",
      outline: "border-white border-t-transparent",
      white: "border-dark-1 border-t-transparent",
    },
  },
  defaultVariants: {
    size: "default",
    variant: "default",
  },
});

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, loading, children, ...props },
    ref
  ) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={loading || props.disabled}
        {...props}
      >
        {loading ? (
          <div className={cn(spinnerVariants({ variant, size }))} />
        ) : (
          children
        )}
      </Comp>
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
