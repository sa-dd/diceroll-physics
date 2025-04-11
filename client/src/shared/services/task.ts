"use server";

import { fetchWithToken, IUserTask, TaskSection } from "@/shared";
import { API_URL } from "../config";

export const getAllTasks = async (type: TaskSection): Promise<IUserTask[]> => {
  const params = new URLSearchParams();
  if (type) params.set("section", type);

  return await fetchWithToken<IUserTask[]>(
    `${API_URL.task}/users?${params.toString()}`,
    {
      cache: "no-cache",
    }
  );
};

export const startTask = async (id: number) => {
  const result = await fetchWithToken(`${API_URL.task}/start/${id}`, {
    method: "POST",
  });

  return result;
};

export const checkTask = async (id: number) => {
  const result = await fetchWithToken(`${API_URL.task}/check/${id}`, {
    method: "POST",
  });

  return result;
};
