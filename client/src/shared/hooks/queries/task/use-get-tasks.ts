"use client";

import { getAllTasks } from "@/shared/services/task";
import { TaskSection } from "@/shared/types";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";

export const useGetTasks = () => {
  const searchParams = useSearchParams();
  const type = (searchParams.get("type") as TaskSection) || "Rollies";

  const { data, isLoading } = useQuery({
    queryKey: ["tasks", type],
    queryFn: () => getAllTasks(type),
  });

  return useMemo(
    () => ({
      data,
      isLoading,
    }),
    [data, isLoading]
  );
};
