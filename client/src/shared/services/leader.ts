"use server";

import { IGetRating } from "@/shared/types";
import { API_URL } from "../config";
import { fetchWithToken } from "@/shared/utils";

export const getLeaderboard = async (): Promise<IGetRating> => {
  return await fetchWithToken<IGetRating>(API_URL.leader, {
    next: { tags: ["rating"] },
  });
};
