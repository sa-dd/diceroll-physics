"use server";

import { API_URL } from "../config";
import { IDailyRollRes } from "../types";
import { fetchWithToken } from "@/shared/utils";

export const dailyRoll = async (): Promise<IDailyRollRes> => {
  return await fetchWithToken<IDailyRollRes>(`${API_URL.roll}/daily`, {
    method: "POST",
  });
};
