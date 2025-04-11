"use client";

import { getAllFriends } from "@/shared/services/friend";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

export const useGetFriends = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["friends"],
    queryFn: () => getAllFriends(),
  });

  return useMemo(
    () => ({
      data,
      isLoading,
    }),
    [data, isLoading]
  );
};
