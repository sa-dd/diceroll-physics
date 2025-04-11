"use server";

import { IGetFriend } from "@/shared/types";
import { API_URL } from "../config";
import { fetchWithToken } from "@/shared/utils";

export const getAllFriends = async (): Promise<IGetFriend> => {
  return await fetchWithToken<IGetFriend>(API_URL.friend, {
    next: { tags: ["friends"] },
  });
};
