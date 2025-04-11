"use server";

import { IBalance, fetchWithToken, API_URL } from "@/shared";

export const getBalance = async (): Promise<IBalance> => {
  return await fetchWithToken(API_URL.balance, {
    next: { tags: ["balance"] },
    cache: "no-cache",
  });
};
