"use server";

import { IUserAuthResponse } from "../types/auth";
import { API_URL } from "../config";
import { saveAccessToken } from "../utils";

export const loginUser = async (
  initData: string
): Promise<IUserAuthResponse> => {
  const response = await fetch(API_URL.auth, {
    method: "POST",
    headers: {
      Authorization: `tma ${initData}`,
    },
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error("Failed to authorize");
  }

  await saveAccessToken(result.accessToken, result.expiresIn);

  return result;
};
