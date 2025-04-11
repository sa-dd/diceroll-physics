"use client";

import { getHistory } from "@/shared/services/history";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

export const useGetHistory = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["history"],
    queryFn: () => getHistory(),
  });

  return useMemo(
    () => ({
      data,
      isLoading,
    }),
    [data, isLoading]
  );
};
