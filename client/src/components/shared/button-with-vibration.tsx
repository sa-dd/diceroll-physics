"use client";

import React, { MouseEvent, PropsWithChildren } from "react";
import { cn } from "@/shared";
import { Button, ButtonProps } from "@/components";
import {
  hapticFeedbackImpactOccurred,
  ImpactHapticFeedbackStyle,
} from "@telegram-apps/sdk-react";

export interface ButtonWithVibrationProps extends ButtonProps {
  className?: string;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  hapticStyle?: ImpactHapticFeedbackStyle;
}

export const ButtonWithVibration: React.FC<
  PropsWithChildren<ButtonWithVibrationProps>
> = ({ className, children, onClick, hapticStyle = "light", ...props }) => {
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    hapticFeedbackImpactOccurred(hapticStyle);

    if (onClick) {
      onClick(e);
    }
  };

  return (
    <Button className={cn(className)} onClick={handleClick} {...props}>
      {children}
    </Button>
  );
};
