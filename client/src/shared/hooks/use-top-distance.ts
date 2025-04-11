"use client";

import { viewportContentSafeAreaInsetTop } from "@telegram-apps/sdk-react";

export const useTopDistance = () => {
  return viewportContentSafeAreaInsetTop() + 64;
};
