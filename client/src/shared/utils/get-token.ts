"use server";

import { cookies } from "next/headers";

export const getAccessToken = () => {
  const token = cookies().get("accessToken")?.value;

  return `Bearer ${token}`;
};

export const saveAccessToken = (accessToken: string, expiresTime: number) => {
  const expires = new Date(Date.now() + expiresTime);

  cookies().set("accessToken", accessToken, {
    secure: true,
    httpOnly: true,
    expires,
  });
};
