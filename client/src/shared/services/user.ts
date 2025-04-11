"use server";

import { IUser, fetchWithToken, API_URL } from "@/shared";

export const getProfile = async (): Promise<IUser> => {
  return await fetchWithToken(`${API_URL.user}/me`, {
    next: { tags: ["user"] },
  });
};
