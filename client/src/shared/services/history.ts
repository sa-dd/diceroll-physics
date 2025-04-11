"use server";

import { IBalanceHistory } from "@/shared/types";
import { API_URL } from "../config";
import { fetchWithToken } from "@/shared/utils";

export const getHistory = async (): Promise<IBalanceHistory[]> => {
  return await fetchWithToken<IBalanceHistory[]>(API_URL.history, {
    next: { tags: ["history"] },
    cache: "no-cache",
  });
};
