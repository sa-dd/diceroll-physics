"use client";

import { GameBoard, PageLayout, RollsBalance } from "@/components";
import React from "react";

export default function Page() {
  return (
    <PageLayout background={"/assets/backgrounds/game.jpg"}>
      <GameBoard />
      <RollsBalance />
    </PageLayout>
  );
}
