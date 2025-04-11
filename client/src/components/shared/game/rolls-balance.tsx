"use client";

import React from "react";
import { cn, IUser, useGetUser } from "@/shared";
import { ItalicText } from "../italic-text";

interface Props {
  className?: string;
}

export const RollsBalance: React.FC<Props> = ({ className }) => {
  return (
    <div
      className={cn(
        "flex flex-col items-center text-center left-1/2 -translate-x-1/2 bottom-[100px] fixed w-full z-[10]",
        className
      )}
    >
      <div className="text-[32px] font-black leading-none italic text-white">
        {100} ROLLS
      </div>
      <ItalicText className="-mt-6">Diamonds</ItalicText>
    </div>
  );
};
