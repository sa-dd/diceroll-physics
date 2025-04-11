"use server";

import { getAccessToken } from "./get-token";

interface FetchOptions extends RequestInit {
  next?: {
    tags?: string[];
    revalidate?: number;
  };
}

export async function fetchWithToken<T>(
  url: string,
  options: FetchOptions = {}
): Promise<T> {
  const token = await getAccessToken();

  const headers = {
    ...options.headers,
    Authorization: token,
  };

  const response: Response = await fetch(url, {
    ...options,
    headers,
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || `Failed to fetch ${url}`);
  }

  return result as T;
}
