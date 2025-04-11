"use client";

import { getLeaderboard } from "@/shared/services/leader";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

export const useGetLeaders = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["leaders"],
    queryFn: () => getLeaderboard(),
  });

  return useMemo(
    () => ({
      data,
      isLoading,
    }),
    [data, isLoading]
  );
};
